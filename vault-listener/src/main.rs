//! pi-dish-vault-listener: a Bitwarden Agent Access listener whose approvals
//! come from pi-dish (TASKS/vault-approvals.md).
//!
//! Runs in a tmux window on the hub. The operator unlocks Bitwarden once on
//! the tty; every credential request from a paired agent host is registered
//! with the local pi-dish, which pushes it to the operator's phone, and only
//! an approval there releases the requested fields of that one item.

mod bridge;
mod envelope;
mod storage;
mod vault;

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use ap_client::{
    CredentialData, CredentialQuery, CredentialRequestReply, DefaultProxyClient, FingerprintVerificationReply, IdentityFingerprint,
    UserClient, UserClientRequest,
};
use secrecy::SecretString;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::oneshot;
use tokio::time::Instant;

use crate::bridge::{Bridge, Decision, Device, NewRequest};
use crate::storage::{FileConnections, FileIdentity};
use crate::vault::Vault;

const DEFAULT_RELAY_URL: &str = "wss://ap.lesspassword.dev";
const DEFAULT_DISH_URL: &str = "http://127.0.0.1:3333";
const HEARTBEAT: Duration = Duration::from_secs(15);
const POLL: Duration = Duration::from_secs(1);
/// Answer before the agent's own `aac run --timeout` gives up.
const ANSWER_MARGIN: Duration = Duration::from_secs(5);
const COMMANDS: &str = "commands: pair <host-name> | status | sync | lock | unlock | quit";
const DEFAULT_DENY_FOLDER: &str = "no-agents";

const USAGE: &str = "Usage: pi-dish-vault-listener [--relay-url URL] [--dish-url URL] [--state-dir DIR] [--token-file FILE] [--bw-bin PATH] [--deny-folder NAME]

Bitwarden Agent Access listener whose approvals come from pi-dish.

  --relay-url URL    Agent Access relay (default wss://ap.lesspassword.dev)
  --dish-url URL     local pi-dish server (default http://127.0.0.1:3333)
  --state-dir DIR    identity and paired hosts (default ~/.pi/dish/vault)
  --token-file FILE  pi-dish bridge token (default ~/.pi/dish/vault/bridge.token)
  --bw-bin PATH      Bitwarden CLI (default bw)
  --deny-folder NAME items in this Bitwarden folder are never listed or released (default no-agents)

Set BW_SESSION to start unlocked; otherwise the master password is read from the tty.";

struct Options {
    relay_url: String,
    dish_url: String,
    state_dir: PathBuf,
    token_file: PathBuf,
    bw_bin: String,
    deny_folder: String,
}

fn parse_options() -> Result<Option<Options>, String> {
    let home = std::env::var_os("HOME").map(PathBuf::from).ok_or("HOME is not set")?;
    let vault_dir = home.join(".pi").join("dish").join("vault");
    let mut options = Options {
        relay_url: DEFAULT_RELAY_URL.to_string(),
        dish_url: DEFAULT_DISH_URL.to_string(),
        state_dir: vault_dir.clone(),
        token_file: vault_dir.join("bridge.token"),
        bw_bin: "bw".to_string(),
        deny_folder: DEFAULT_DENY_FOLDER.to_string(),
    };
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        if flag == "--help" || flag == "-h" {
            return Ok(None);
        }
        let value = args.next().ok_or_else(|| format!("{flag} needs a value"))?;
        match flag.as_str() {
            "--relay-url" => options.relay_url = value,
            "--dish-url" => options.dish_url = value,
            "--state-dir" => options.state_dir = PathBuf::from(value),
            "--token-file" => options.token_file = PathBuf::from(value),
            "--bw-bin" => options.bw_bin = value,
            "--deny-folder" => options.deny_folder = value,
            _ => return Err(format!("unknown option {flag}")),
        }
    }
    Ok(Some(options))
}

fn main() -> ExitCode {
    let options = match parse_options() {
        Ok(Some(options)) => options,
        Ok(None) => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Err(error) => {
            eprintln!("pi-dish-vault-listener: {error}\n\n{USAGE}");
            return ExitCode::FAILURE;
        }
    };
    // Take the session key out of the environment before any thread exists,
    // so no child process ever inherits it.
    let session = std::env::var("BW_SESSION").ok().filter(|value| !value.is_empty()).map(SecretString::from);
    // SAFETY: no other thread exists yet; the runtime is built below.
    unsafe { std::env::remove_var("BW_SESSION") };
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")))
        .with_writer(std::io::stderr)
        .init();
    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("pi-dish-vault-listener: {error}");
            return ExitCode::FAILURE;
        }
    };
    match runtime.block_on(run(options, session)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("pi-dish-vault-listener: {error}");
            ExitCode::FAILURE
        }
    }
}

fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Prompts on the tty (never echoed, never through pi-dish) and unlocks.
async fn unlock_interactive(vault: &Vault) {
    match vault.status().await {
        (Some(status), _) if status == "unauthenticated" => {
            println!("Bitwarden is not logged in: run `bw login` in another shell, then `unlock`.");
            return;
        }
        (None, _) => {
            println!("Could not run the Bitwarden CLI; check --bw-bin, then `unlock`.");
            return;
        }
        _ => {}
    }
    let prompt = tokio::task::spawn_blocking(|| rpassword::prompt_password("Bitwarden master password: ")).await;
    let password = match prompt {
        Ok(Ok(password)) if !password.is_empty() => SecretString::from(password),
        _ => {
            println!("No password read; the vault stays locked. Type `unlock` to retry.");
            return;
        }
    };
    match vault.unlock(password).await {
        Ok(()) => {
            println!("Vault unlocked.");
            if let Err(error) = vault.sync().await {
                println!("bw sync failed: {error}");
            }
        }
        Err(error) => println!("Unlock failed: {error}"),
    }
}

async fn report(vault: &Vault, bridge: &Bridge, state_dir: &Path) {
    let state = if vault.is_unlocked() { "ready" } else { "locked" };
    let (_, account) = vault.status().await;
    let devices: Vec<Device> = FileConnections::load(state_dir)
        .map(|connections| connections.devices())
        .unwrap_or_default()
        .into_iter()
        .map(|(name, fingerprint)| Device { name, fingerprint })
        .collect();
    if let Err(error) = bridge.report_status(state, account.as_deref(), &devices).await {
        tracing::warn!("status heartbeat: {error}");
    }
}

fn deny(reply: oneshot::Sender<CredentialRequestReply>) {
    let _ = reply.send(CredentialRequestReply { approved: false, credential: None, credential_id: None });
}

/// Answers a probe the listener handles itself; carries no secret.
fn answer(reply: oneshot::Sender<CredentialRequestReply>, notes: Option<String>) {
    let credential = CredentialData { username: None, password: None, totp: None, uri: None, notes, credential_id: None, domain: None };
    let _ = reply.send(CredentialRequestReply { approved: true, credential: Some(credential), credential_id: None });
}

async fn handle_request(
    vault: Arc<Vault>,
    bridge: Arc<Bridge>,
    state_dir: PathBuf,
    query: CredentialQuery,
    identity: IdentityFingerprint,
    reply: oneshot::Sender<CredentialRequestReply>,
) {
    let fingerprint = identity.to_hex();
    let device = FileConnections::load(&state_dir)
        .ok()
        .and_then(|connections| connections.name_of(&identity))
        .unwrap_or_else(|| format!("device {}", fingerprint.get(..8).unwrap_or(&fingerprint)));
    if query.search_string() == envelope::PAIR_PROBE {
        println!("Paired {device}.");
        return answer(reply, None);
    }
    if query.search_string() == envelope::SYNC_PROBE {
        let synced = if vault.is_unlocked() { vault.sync().await } else { Err("the vault is locked (type `unlock`)".to_string()) };
        return match synced {
            Ok(()) => {
                println!("{device} synced the vault.");
                answer(reply, None);
            }
            Err(error) => {
                println!("Refused a sync from {device}: {error}");
                deny(reply);
            }
        };
    }
    if let Some(search) = envelope::search_query(&query) {
        let listing = match search {
            Ok(text) => vault.search(&text).await.map(|found| (text, found)),
            Err(error) => Err(error),
        };
        return match listing.and_then(|(text, found)| serde_json::to_string(&found).map(|json| (text, found.results.len(), json)).map_err(|e| e.to_string())) {
            Ok((text, count, json)) => {
                println!("{device} searched {text:?}: {count} item(s) listed.");
                answer(reply, Some(json));
            }
            Err(error) => {
                println!("Refused a search from {device}: {error}");
                deny(reply);
            }
        };
    }
    let request = match envelope::decode(&query) {
        Ok(request) => request,
        Err(error) => {
            println!("Refused a malformed request from {device}: {error}");
            return deny(reply);
        }
    };
    if !vault.is_unlocked() {
        println!("Denied {} for {device}: the vault is locked (type `unlock`).", request.item);
        return deny(reply);
    }
    // Resolve the item before asking: the card names it, and deny-folder items never reach pi-dish.
    let prepared = match vault.prepare(&request.item).await {
        Ok(prepared) => prepared,
        Err(error) => {
            println!("Denied {} for {device}: {error}", request.item);
            return deny(reply);
        }
    };
    let id = uuid::Uuid::new_v4().to_string();
    let lifetime = Duration::from_secs(request.timeout_sec).saturating_sub(ANSWER_MARGIN);
    let deadline = Instant::now() + lifetime;
    let new_request = NewRequest {
        id: &id,
        device: Device { name: device.clone(), fingerprint },
        item: &prepared.name,
        fields: &request.fields,
        reason: request.reason.as_deref(),
        session: request.session.as_ref(),
        expires_at: now_millis() + lifetime.as_millis() as u64,
    };
    let first = match bridge.create(&new_request).await {
        Ok(decision) => decision,
        Err(error) => {
            println!("Denied {} for {device}: {error}", request.item);
            return deny(reply);
        }
    };
    let short = id.get(..8).unwrap_or(&id).to_string();
    println!("[{short}] {device} wants {} ({}) — waiting for pi-dish", prepared.name, request.fields.join(", "));
    let poller = bridge.clone();
    let decision = bridge::await_decision(first, deadline, POLL, || {
        let poller = poller.clone();
        let id = id.clone();
        async move { poller.poll(&id).await }
    })
    .await;
    if decision != Decision::Approved {
        if decision == Decision::Expired {
            bridge.abandon(&id).await;
        }
        println!("[{short}] {decision:?}");
        return deny(reply);
    }
    match vault.release(&prepared, &request.fields).await {
        Ok(credential) => {
            let credential_id = credential.credential_id.clone();
            let delivered = reply.send(CredentialRequestReply { approved: true, credential: Some(credential), credential_id }).is_ok();
            println!("[{short}] approved — {}", if delivered { "released" } else { "the requester had already gone" });
        }
        Err(error) => {
            println!("[{short}] approved but not released: {error}");
            deny(reply);
        }
    }
}

async fn run(options: Options, session: Option<SecretString>) -> Result<(), String> {
    storage::ensure_dir(&options.state_dir).map_err(|e| format!("{}: {e}", options.state_dir.display()))?;
    let vault = Arc::new(Vault::new(options.bw_bin.clone(), options.deny_folder.clone(), session));
    if vault.is_unlocked() {
        if let Err(error) = vault.sync().await {
            println!("bw sync failed: {error}");
        }
    } else {
        unlock_interactive(&vault).await;
    }

    let identity = FileIdentity::load_or_generate(&options.state_dir).map_err(|e| e.to_string())?;
    let connections = FileConnections::load(&options.state_dir).map_err(|e| e.to_string())?;
    let proxy = DefaultProxyClient::from_url(options.relay_url.clone());
    let handle = UserClient::connect(Box::new(identity), Box::new(connections), Box::new(proxy), None, None)
        .await
        .map_err(|e| format!("could not reach the relay {}: {e}", options.relay_url))?;
    let client = handle.client;
    let mut notifications = handle.notifications;
    tokio::spawn(async move {
        while let Some(notification) = notifications.recv().await {
            tracing::debug!(?notification, "agent access");
        }
    });

    let bridge = Arc::new(Bridge::new(options.dish_url.clone(), options.token_file.clone()));
    {
        let (vault, bridge, dir) = (vault.clone(), bridge.clone(), options.state_dir.clone());
        tokio::spawn(async move {
            loop {
                report(&vault, &bridge, &dir).await;
                tokio::time::sleep(HEARTBEAT).await;
            }
        });
    }
    {
        let (vault, bridge, dir) = (vault.clone(), bridge.clone(), options.state_dir.clone());
        let mut requests = handle.requests;
        tokio::spawn(async move {
            while let Some(request) = requests.recv().await {
                match request {
                    // Pairing is PSK-only; a rendezvous handshake is never ours.
                    UserClientRequest::VerifyFingerprint { reply, .. } => {
                        println!("Refused a rendezvous pairing; pair hosts with `pair <host-name>`.");
                        let _ = reply.send(FingerprintVerificationReply { approved: false, name: None });
                    }
                    UserClientRequest::CredentialRequest { query, identity, reply } => {
                        tokio::spawn(handle_request(vault.clone(), bridge.clone(), dir.clone(), query, identity, reply));
                    }
                }
            }
        });
    }

    println!("Listening via {} for pi-dish at {}; {COMMANDS}", options.relay_url, options.dish_url);
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    // Commands run one at a time, so no stdin read is outstanding while
    // `unlock` reads the password from the tty.
    while let Ok(Some(line)) = lines.next_line().await {
        let mut words = line.split_whitespace();
        match (words.next(), words.next()) {
            (None, _) => {}
            (Some("pair"), Some(name)) if name.len() <= 64 => match client.get_psk_token(Some(name.to_string()), false).await {
                Ok(token) => println!(
                    "Single-use token for {name} (valid 10 minutes). On {name} run:\n  node ~/.pi/agent/skills/pi-dish-vault/scripts/pi-dish-vault.js pair {token}"
                ),
                Err(error) => println!("Could not create a pairing token: {error}"),
            },
            (Some("status"), None) => {
                let (status, account) = vault.status().await;
                let devices = FileConnections::load(&options.state_dir).map(|c| c.devices()).unwrap_or_default();
                println!(
                    "Vault {} ({}, bw: {}); paired: {}",
                    if vault.is_unlocked() { "unlocked" } else { "locked" },
                    account.unwrap_or_else(|| "no account".to_string()),
                    status.unwrap_or_else(|| "unavailable".to_string()),
                    if devices.is_empty() { "none".to_string() } else { devices.into_iter().map(|(name, _)| name).collect::<Vec<_>>().join(", ") },
                );
            }
            (Some("sync"), None) => match vault.sync().await {
                Ok(()) => println!("Synced."),
                Err(error) => println!("bw sync failed: {error}"),
            },
            (Some("lock"), None) => {
                vault.lock();
                println!("Vault locked; requests are denied until `unlock`.");
                report(&vault, &bridge, &options.state_dir).await;
            }
            (Some("unlock"), None) => {
                unlock_interactive(&vault).await;
                report(&vault, &bridge, &options.state_dir).await;
            }
            (Some("quit" | "exit"), None) => break,
            // Never echo the input: a mistyped line could be a password.
            _ => println!("Unrecognized; {COMMANDS}"),
        }
    }
    vault.lock();
    report(&vault, &bridge, &options.state_dir).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// A `bw` that logs its arguments beside itself and fails while a `fail` file exists.
    fn stub_bw(dir: &Path) -> String {
        let bw = dir.join("bw");
        std::fs::write(&bw, "#!/bin/sh\ndir=$(dirname \"$0\")\necho \"$*\" >> \"$dir/calls\"\n[ ! -e \"$dir/fail\" ] || { echo 'sync failed' >&2; exit 1; }\n").expect("write stub");
        std::fs::set_permissions(&bw, std::fs::Permissions::from_mode(0o755)).expect("chmod stub");
        bw.to_string_lossy().into_owned()
    }

    async fn sync_probe(vault: Vault, dir: &Path) -> bool {
        let (reply, answer) = oneshot::channel();
        let bridge = Arc::new(Bridge::new("http://127.0.0.1:9".to_string(), dir.join("bridge.token")));
        let query = CredentialQuery::Domain(envelope::SYNC_PROBE.to_string());
        handle_request(Arc::new(vault), bridge, dir.to_path_buf(), query, IdentityFingerprint([7; 32]), reply).await;
        answer.await.expect("a reply").approved
    }

    #[tokio::test]
    async fn a_sync_probe_runs_bw_sync_only_while_unlocked() {
        let dir = std::env::temp_dir().join(format!("pi-dish-vault-sync-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let bw = stub_bw(&dir);
        let unlocked = || Vault::new(bw.clone(), DEFAULT_DENY_FOLDER.to_string(), Some(SecretString::from("session-key")));
        let calls = || std::fs::read_to_string(dir.join("calls")).unwrap_or_default();

        assert!(!sync_probe(Vault::new(bw.clone(), DEFAULT_DENY_FOLDER.to_string(), None), &dir).await, "locked: refused");
        assert_eq!(calls(), "", "locked: bw never runs");
        assert!(sync_probe(unlocked(), &dir).await, "unlocked: approved");
        assert_eq!(calls(), "sync\n");
        std::fs::write(dir.join("fail"), "").expect("fail marker");
        assert!(!sync_probe(unlocked(), &dir).await, "a failed sync is refused");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
