//! The unlocked Bitwarden vault, through the `bw` CLI. The session key lives
//! only in this process's memory and reaches `bw` children through their
//! environment; it is never logged or written.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use std::process::Stdio;
use std::sync::RwLock;

use ap_client::CredentialData;
use secrecy::{ExposeSecret, SecretString};
use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use zeroize::Zeroizing;

use crate::envelope::{CreateEnvelope, custom_field};

#[derive(Deserialize)]
struct BwUri {
    uri: Option<String>,
}

#[derive(Deserialize)]
struct BwLogin {
    username: Option<String>,
    password: Option<String>,
    totp: Option<String>,
    uris: Option<Vec<BwUri>>,
}

#[derive(Deserialize)]
struct BwField {
    name: Option<String>,
    value: Option<String>,
}

#[derive(Deserialize)]
struct BwItem {
    id: Option<String>,
    notes: Option<String>,
    login: Option<BwLogin>,
    fields: Option<Vec<BwField>>,
}

/// Only the requested fields of a `bw get item` document. A requested field
/// the item lacks is an error, so a command never runs with an empty secret.
///
/// aac carries only the five built-in slots, so `field:<name>` values travel
/// in `notes` as `{"fields":{"<name>":"<value>"},"notes":<notes or null>}`;
/// `pi-dish-vault run` unpacks that bundle into the requested variables.
pub fn credential_from_item(json: &[u8], fields: &[String], totp_code: Option<String>) -> Result<CredentialData, String> {
    let item: BwItem = serde_json::from_slice(json).map_err(|e| format!("unexpected bw output: {e}"))?;
    let login = item.login.unwrap_or(BwLogin { username: None, password: None, totp: None, uris: None });
    let has_totp = login.totp.is_some();
    let uri = login.uris.and_then(|uris| uris.into_iter().find_map(|entry| entry.uri));
    let mut credential = CredentialData {
        username: None,
        password: None,
        totp: None,
        uri: None,
        notes: None,
        credential_id: item.id,
        domain: None,
    };
    let mut custom = serde_json::Map::new();
    for field in fields {
        if let Some(name) = custom_field(field) {
            let matches: Vec<&BwField> = item.fields.iter().flatten().filter(|entry| entry.name.as_deref() == Some(name)).collect();
            let value = match matches.as_slice() {
                [] => return Err(format!("the item has no field {name:?}")),
                [entry] => entry.value.as_deref().filter(|value| !value.is_empty()).ok_or_else(|| format!("the item's field {name:?} is empty"))?,
                _ => return Err(format!("the item has several fields named {name:?}")),
            };
            custom.insert(name.to_string(), serde_json::Value::String(value.to_string()));
            continue;
        }
        let missing = match field.as_str() {
            "username" => { credential.username = login.username.clone(); credential.username.is_none() }
            "password" => { credential.password = login.password.clone().map(Zeroizing::new); credential.password.is_none() }
            "totp" => { credential.totp = if has_totp { totp_code.clone() } else { None }; credential.totp.is_none() }
            "uri" => { credential.uri = uri.clone(); credential.uri.is_none() }
            "notes" => { credential.notes = item.notes.clone(); credential.notes.is_none() }
            other => return Err(format!("unknown field {other}")),
        };
        if missing {
            return Err(format!("the item has no {field}"));
        }
    }
    if !custom.is_empty() {
        let bundle = serde_json::json!({ "fields": custom, "notes": credential.notes.take() });
        credential.notes = Some(bundle.to_string());
    }
    Ok(credential)
}

pub struct Vault {
    bw: String,
    /// Items in the Bitwarden folder with this name are invisible to agents.
    deny_folder: String,
    /// Items agents create land in the Bitwarden folder with this name.
    create_folder: String,
    session: RwLock<Option<SecretString>>,
}

impl Vault {
    pub fn new(bw: String, deny_folder: String, create_folder: String, session: Option<SecretString>) -> Self {
        Self { bw, deny_folder, create_folder, session: RwLock::new(session) }
    }

    pub fn create_folder(&self) -> &str {
        &self.create_folder
    }

    fn session(&self) -> Option<SecretString> {
        self.session.read().ok().and_then(|guard| guard.clone())
    }

    pub fn is_unlocked(&self) -> bool {
        self.session().is_some()
    }

    pub fn lock(&self) {
        if let Ok(mut guard) = self.session.write() {
            *guard = None;
        }
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(&self.bw);
        command.args(args).env_remove("BW_SESSION").env_remove("BW_MASTER_PASSWORD").kill_on_drop(true);
        if let Some(session) = self.session() {
            command.env("BW_SESSION", session.expose_secret());
        }
        command
    }

    async fn run(&self, args: &[&str]) -> Result<Vec<u8>, String> {
        let output = self.command(args).output().await.map_err(|e| format!("could not run {}: {e}", self.bw))?;
        if output.status.success() {
            return Ok(output.stdout);
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() { format!("bw {} failed", args.first().unwrap_or(&"")) } else { stderr })
    }

    /// `bw <args>` with `input` on stdin, so secrets never appear in argv.
    async fn run_with_input(&self, args: &[&str], input: &[u8]) -> Result<Vec<u8>, String> {
        let mut child = self
            .command(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("could not run {}: {e}", self.bw))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(input).await.map_err(|e| format!("could not write to bw: {e}"))?;
        }
        let output = child.wait_with_output().await.map_err(|e| format!("could not run {}: {e}", self.bw))?;
        if output.status.success() {
            return Ok(output.stdout);
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() { format!("bw {} failed", args.first().unwrap_or(&"")) } else { stderr })
    }

    /// `bw status` → (status, account email). Status is `unauthenticated`, `locked` or `unlocked`.
    pub async fn status(&self) -> (Option<String>, Option<String>) {
        let Ok(stdout) = self.run(&["status"]).await else { return (None, None) };
        let value: serde_json::Value = serde_json::from_slice(&stdout).unwrap_or_default();
        (value["status"].as_str().map(String::from), value["userEmail"].as_str().map(String::from))
    }

    pub async fn unlock(&self, password: SecretString) -> Result<(), String> {
        let output = Command::new(&self.bw)
            .args(["unlock", "--passwordenv", "BW_MASTER_PASSWORD", "--raw"])
            .env_remove("BW_SESSION")
            .env("BW_MASTER_PASSWORD", password.expose_secret())
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|e| format!("could not run {}: {e}", self.bw))?;
        drop(password);
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() { "bw unlock failed".to_string() } else { stderr });
        }
        let key = Zeroizing::new(String::from_utf8_lossy(&output.stdout).trim().to_string());
        if key.is_empty() {
            return Err("bw unlock returned no session key".to_string());
        }
        if let Ok(mut guard) = self.session.write() {
            *guard = Some(SecretString::from(key.as_str()));
        }
        Ok(())
    }

    pub async fn sync(&self) -> Result<(), String> {
        self.run(&["sync"]).await.map(|_| ())
    }

    async fn folders(&self) -> Result<Vec<BwFolder>, String> {
        serde_json::from_slice(&self.run(&["list", "folders"]).await?).map_err(|e| format!("unexpected bw output: {e}"))
    }

    /// The id of the folder agents may never see, if it exists.
    async fn denied_folder(&self) -> Result<Option<String>, String> {
        Ok(self.folders().await?.into_iter().find(|folder| folder.name.as_deref() == Some(self.deny_folder.as_str())).and_then(|folder| folder.id))
    }

    /// Refuses a create before the operator is asked: a locked vault, or a
    /// visible item with the same name (names stay usable with `run --item`).
    pub async fn check_create(&self, name: &str) -> Result<(), String> {
        if !self.is_unlocked() {
            return Err("the vault is locked (the operator types `unlock` in the listener window)".to_string());
        }
        let found = self.search(name).await?;
        match found.results.iter().find(|entry| entry.name == name) {
            Some(existing) => Err(format!("an item named {name:?} already exists ({}); choose another name", existing.id)),
            None => Ok(()),
        }
    }

    /// After approval: a generated password, then a new login in the create
    /// folder (made on first use). The password reaches `bw` only on stdin.
    pub async fn create(&self, request: &CreateEnvelope) -> Result<String, String> {
        let folder = match self.folders().await?.into_iter().find(|folder| folder.name.as_deref() == Some(self.create_folder.as_str())) {
            Some(BwFolder { id: Some(id), .. }) => id,
            _ => {
                let body = STANDARD.encode(serde_json::json!({ "name": self.create_folder }).to_string());
                let created: BwFolder = serde_json::from_slice(&self.run_with_input(&["create", "folder"], body.as_bytes()).await?).map_err(|e| format!("unexpected bw output: {e}"))?;
                created.id.ok_or("bw created a folder without an id")?
            }
        };
        let length = request.length.to_string();
        let password = Zeroizing::new(String::from_utf8_lossy(&Zeroizing::new(self.run(&["generate", "-ulns", "--length", &length]).await?)).trim().to_string());
        if password.chars().count() != usize::from(request.length) {
            return Err("bw generate returned an unexpected password".to_string());
        }
        let document = Zeroizing::new(new_login(request, &folder, &password).to_string());
        let body = Zeroizing::new(STANDARD.encode(document.as_bytes()));
        let created: BwSummary = serde_json::from_slice(&Zeroizing::new(self.run_with_input(&["create", "item"], body.as_bytes()).await?)).map_err(|e| format!("unexpected bw output: {e}"))?;
        created.id.ok_or_else(|| "bw created an item without an id".to_string())
    }

    /// Names, ids and URIs (never values) of items matching `query`, outside the deny folder.
    pub async fn search(&self, query: &str) -> Result<SearchResults, String> {
        if !self.is_unlocked() {
            return Err("the vault is locked".to_string());
        }
        let denied = self.denied_folder().await?;
        let mut args = vec!["list", "items"];
        if !query.is_empty() {
            args.extend(["--search", query]);
        }
        let listing = Zeroizing::new(self.run(&args).await?);
        search_results(&listing, denied.as_deref(), SEARCH_LIMIT)
    }

    /// Looks an item up before asking the operator: its display name, and a
    /// refusal when it is missing, ambiguous, in the deny folder or lacks a
    /// requested field. The document stays in memory only until the request
    /// is answered.
    pub async fn prepare(&self, item: &str, fields: &[String]) -> Result<Prepared, Refusal> {
        if !self.is_unlocked() {
            return Err(Refusal::plain("the vault is locked (the operator types `unlock` in the listener window)"));
        }
        let document = Zeroizing::new(self.run(&["get", "item", item]).await.map_err(|error| lookup_refusal(item, error))?);
        let summary: BwSummary = serde_json::from_slice(&document).map_err(|e| Refusal::plain(format!("unexpected bw output: {e}")))?;
        if let (Some(folder), Some(denied)) = (summary.folder_id.as_deref(), self.denied_folder().await.map_err(Refusal::plain)?) {
            if folder == denied {
                // Search hides these items; the requester sees a missing item.
                return Err(Refusal { log: format!("the item is in the \"{}\" folder", self.deny_folder), requester: no_item(item) });
            }
        }
        let name = summary.name.clone().unwrap_or_else(|| item.to_string());
        if let Some(error) = missing_fields(&name, &summary, fields) {
            return Err(Refusal::plain(error));
        }
        Ok(Prepared { id: summary.id.unwrap_or_else(|| item.to_string()), name, document })
    }

    /// The requested fields of a prepared item, after approval.
    pub async fn release(&self, prepared: &Prepared, fields: &[String]) -> Result<CredentialData, String> {
        let totp = if fields.iter().any(|field| field == "totp") {
            self.run(&["get", "totp", &prepared.id]).await.ok().map(|code| String::from_utf8_lossy(&code).trim().to_string())
        } else {
            None
        };
        credential_from_item(&prepared.document, fields, totp)
    }
}

/// The `bw create item` document for a new login (Bitwarden's item template, type 1).
fn new_login(request: &CreateEnvelope, folder_id: &str, password: &str) -> serde_json::Value {
    let uris: Vec<serde_json::Value> = request.uri.iter().map(|uri| serde_json::json!({ "match": null, "uri": uri })).collect();
    serde_json::json!({
        "organizationId": null,
        "collectionIds": null,
        "folderId": folder_id,
        "type": 1,
        "name": request.name,
        "notes": null,
        "favorite": false,
        "fields": [],
        "login": { "uris": uris, "username": request.username, "password": password, "totp": null },
        "reprompt": 0,
    })
}

/// Why a request was refused before approval: the listener window's line and
/// what the requester is told, which omits deny-folder items and their ids.
#[derive(Debug)]
pub struct Refusal {
    pub log: String,
    pub requester: String,
}

impl Refusal {
    pub fn plain(reason: impl Into<String>) -> Self {
        let reason = reason.into();
        Self { log: reason.clone(), requester: reason }
    }
}

fn no_item(item: &str) -> String {
    format!("no item {item:?}; find its id with `search`")
}

/// `bw get item` failures in requester terms; the ambiguity list may name deny-folder ids, so it is dropped.
fn lookup_refusal(item: &str, error: String) -> Refusal {
    if error.starts_with("Not found") {
        Refusal { log: error, requester: no_item(item) }
    } else if error.starts_with("More than one result") {
        Refusal { log: error, requester: format!("several items match {item:?}; request one by its id from `search`") }
    } else {
        Refusal::plain(error)
    }
}

/// The refusal for requested fields the item cannot supply, naming the ones it has.
fn missing_fields(name: &str, item: &BwSummary, fields: &[String]) -> Option<String> {
    let available = requestable_fields(item);
    let missing: Vec<&str> = fields.iter().filter(|field| !available.contains(field)).map(String::as_str).collect();
    if missing.is_empty() {
        return None;
    }
    let has = if available.is_empty() { "no requestable fields".to_string() } else { available.join(", ") };
    Some(format!("{name:?} has no {}; it has {has}", missing.join(", ")))
}

pub const SEARCH_LIMIT: usize = 100;

pub struct Prepared {
    pub id: String,
    pub name: String,
    document: Zeroizing<Vec<u8>>,
}

#[derive(Deserialize)]
struct BwFolder {
    id: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BwSummary {
    id: Option<String>,
    name: Option<String>,
    folder_id: Option<String>,
    #[serde(rename = "type")]
    kind: Option<u8>,
    // Presence only: values are skipped, never copied out of the listing.
    notes: Option<IgnoredAny>,
    login: Option<BwLoginSummary>,
    fields: Option<Vec<BwFieldName>>,
}

#[derive(Deserialize)]
struct BwLoginSummary {
    username: Option<IgnoredAny>,
    password: Option<IgnoredAny>,
    totp: Option<IgnoredAny>,
    uris: Option<Vec<BwUri>>,
}

#[derive(Deserialize)]
struct BwFieldName {
    name: Option<String>,
    /// 0 text, 1 hidden, 2 boolean, 3 linked (no value of its own).
    #[serde(rename = "type")]
    kind: Option<u8>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SearchEntry {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    pub uris: Vec<String>,
    /// The fields a request may name: built-ins the item has, then
    /// `field:<name>` for each custom field with a value of its own.
    pub fields: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SearchResults {
    pub results: Vec<SearchEntry>,
    pub truncated: bool,
}

fn requestable_fields(item: &BwSummary) -> Vec<String> {
    let login = item.login.as_ref();
    let builtin = [
        ("username", login.is_some_and(|login| login.username.is_some())),
        ("password", login.is_some_and(|login| login.password.is_some())),
        ("totp", login.is_some_and(|login| login.totp.is_some())),
        ("uri", login.and_then(|login| login.uris.as_ref()).is_some_and(|uris| uris.iter().any(|uri| uri.uri.is_some()))),
        ("notes", item.notes.is_some()),
    ];
    let custom = item.fields.iter().flatten().filter(|field| field.kind != Some(3)).filter_map(|field| field.name.as_deref()).map(|name| format!("field:{name}"));
    builtin.into_iter().filter(|(_, present)| *present).map(|(name, _)| name.to_string()).chain(custom).collect()
}

/// Item metadata from `bw list items`, minus the deny folder and every value.
pub fn search_results(json: &[u8], denied_folder: Option<&str>, limit: usize) -> Result<SearchResults, String> {
    let items: Vec<BwSummary> = serde_json::from_slice(json).map_err(|e| format!("unexpected bw output: {e}"))?;
    let mut results: Vec<SearchEntry> = items
        .into_iter()
        .filter(|item| denied_folder.is_none() || item.folder_id.as_deref() != denied_folder)
        .filter_map(|item| {
            let fields = requestable_fields(&item);
            Some(SearchEntry {
                id: item.id?,
                name: item.name.unwrap_or_default(),
                kind: match item.kind {
                    Some(1) => "login",
                    Some(2) => "note",
                    Some(3) => "card",
                    Some(4) => "identity",
                    _ => "other",
                },
                uris: item.login.and_then(|login| login.uris).unwrap_or_default().into_iter().filter_map(|uri| uri.uri).collect(),
                fields,
            })
        })
        .collect();
    let truncated = results.len() > limit;
    results.truncate(limit);
    Ok(SearchResults { results, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ITEM: &str = r#"{"id":"0f1","name":"github.com","notes":"recovery codes",
      "login":{"username":"me","password":"hunter2","totp":"otpauth://seed","uris":[{"uri":null},{"uri":"https://github.com"}]}}"#;

    fn fields(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_string()).collect()
    }

    #[test]
    fn only_requested_fields_are_released() {
        let credential = credential_from_item(ITEM.as_bytes(), &fields(&["password"]), None).expect("password present");
        assert_eq!(credential.password.as_deref().map(String::as_str), Some("hunter2"));
        assert_eq!(credential.username, None);
        assert_eq!(credential.notes, None);
        assert_eq!(credential.totp, None);
        assert_eq!(credential.credential_id.as_deref(), Some("0f1"));
    }

    #[test]
    fn totp_is_the_current_code_never_the_seed() {
        let credential = credential_from_item(ITEM.as_bytes(), &fields(&["totp", "uri", "notes"]), Some("123456".to_string())).expect("fields present");
        assert_eq!(credential.totp.as_deref(), Some("123456"));
        assert_eq!(credential.uri.as_deref(), Some("https://github.com"));
        assert_eq!(credential.notes.as_deref(), Some("recovery codes"));
        assert!(credential_from_item(ITEM.as_bytes(), &fields(&["totp"]), None).is_err());
    }

    #[test]
    fn a_missing_field_refuses_the_release() {
        let note = r#"{"id":"n1","notes":"API_KEY=abc","login":null}"#;
        assert!(credential_from_item(note.as_bytes(), &fields(&["password"]), None).is_err());
        let credential = credential_from_item(note.as_bytes(), &fields(&["notes"]), None).expect("secure note body");
        assert_eq!(credential.notes.as_deref(), Some("API_KEY=abc"));
        assert!(credential_from_item(b"not json", &fields(&["notes"]), None).is_err());
    }

    #[test]
    fn custom_fields_travel_as_a_bundle_in_notes() {
        let note = r#"{"id":"n1","notes":"body","login":null,"fields":[
          {"name":"api-key","value":"sk-1","type":1},{"name":"region","value":"us","type":0},
          {"name":"dup","value":"a","type":0},{"name":"dup","value":"b","type":0},{"name":"blank","value":"","type":1}]}"#;
        let only = credential_from_item(note.as_bytes(), &fields(&["field:api-key"]), None).expect("hidden field present");
        let bundle: serde_json::Value = serde_json::from_str(only.notes.as_deref().expect("bundle")).expect("bundle JSON");
        assert_eq!(bundle, serde_json::json!({ "fields": { "api-key": "sk-1" }, "notes": null }));
        let both = credential_from_item(note.as_bytes(), &fields(&["notes", "field:api-key", "field:region"]), None).expect("present");
        let bundle: serde_json::Value = serde_json::from_str(both.notes.as_deref().expect("bundle")).expect("bundle JSON");
        assert_eq!(bundle, serde_json::json!({ "fields": { "api-key": "sk-1", "region": "us" }, "notes": "body" }));
        for refused in ["field:missing", "field:dup", "field:blank"] {
            assert!(credential_from_item(note.as_bytes(), &fields(&[refused]), None).is_err(), "{refused}");
        }
    }

    #[test]
    fn search_lists_metadata_only_and_hides_the_deny_folder() {
        let listing = r#"[
          {"id":"a","name":"github.com","type":1,"folderId":null,"login":{"username":"me","password":"hunter2","uris":[{"uri":"https://github.com"}]}},
          {"id":"b","name":"bank","type":1,"folderId":"private","login":{"password":"pin"}},
          {"id":"c","name":"api keys","type":2,"folderId":"work","notes":"KEY=1",
           "fields":[{"name":"api-key","value":"sk-secret","type":1},{"name":"linked","value":null,"type":3}]},
          {"name":"no id","type":1}
        ]"#;
        let found = search_results(listing.as_bytes(), Some("private"), 10).expect("valid listing");
        assert_eq!(found.results.iter().map(|entry| entry.id.as_str()).collect::<Vec<_>>(), vec!["a", "c"]);
        assert_eq!(found.results[0].uris, vec!["https://github.com"]);
        assert_eq!(found.results[1].kind, "note");
        assert_eq!(found.results[0].fields, vec!["username", "password", "uri"]);
        assert_eq!(found.results[1].fields, vec!["notes", "field:api-key"]);
        let text = serde_json::to_string(&found.results).expect("serializable");
        assert!(!text.contains("hunter2") && !text.contains("KEY=1") && !text.contains("\"me\"") && !text.contains("sk-secret"));
        let capped = search_results(listing.as_bytes(), None, 2).expect("valid listing");
        assert_eq!(capped.results.len(), 2);
        assert!(capped.truncated);
    }

    #[test]
    fn missing_fields_are_named_beside_the_available_ones() {
        let note: BwSummary = serde_json::from_str(r#"{"id":"n1","name":"huggingface-read","type":2,"login":null,
          "fields":[{"name":"key","value":"hf_secret","type":1}]}"#).expect("summary");
        assert_eq!(missing_fields("huggingface-read", &note, &fields(&["field:key"])), None);
        assert_eq!(
            missing_fields("huggingface-read", &note, &fields(&["password", "field:key", "field:token"])).as_deref(),
            Some(r#""huggingface-read" has no password, field:token; it has field:key"#),
        );
        let empty: BwSummary = serde_json::from_str(r#"{"id":"e","name":"empty","type":2}"#).expect("summary");
        assert_eq!(missing_fields("empty", &empty, &fields(&["notes"])).as_deref(), Some(r#""empty" has no notes; it has no requestable fields"#));
    }

    #[test]
    fn lookup_failures_hide_ids_from_the_requester() {
        assert_eq!(lookup_refusal("hf", "Not found.".to_string()).requester, r#"no item "hf"; find its id with `search`"#);
        let ambiguous = lookup_refusal("hf", "More than one result was found. Try getting a specific object by `id` instead. The following objects were found:\nsecret-id".to_string());
        assert!(ambiguous.log.contains("secret-id") && !ambiguous.requester.contains("secret-id"));
    }

    #[test]
    fn a_new_login_holds_only_what_was_asked_for() {
        let request = CreateEnvelope {
            name: "grafana".to_string(), username: None, uri: Some("https://g.lan".to_string()),
            length: 32, reason: None, session: None, timeout_sec: 60,
        };
        let item = new_login(&request, "f1", "pw");
        assert_eq!(item["folderId"], "f1");
        assert_eq!(item["type"], 1);
        assert_eq!(item["login"], serde_json::json!({ "uris": [{ "match": null, "uri": "https://g.lan" }], "username": null, "password": "pw", "totp": null }));
    }

    #[tokio::test]
    async fn create_makes_the_folder_once_and_passes_the_password_only_on_stdin() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("pi-dish-vault-create-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let bw = dir.join("bw");
        // `list folders` lists the create folder once `folder` exists; `create` logs its decoded stdin.
        std::fs::write(&bw, r#"#!/bin/sh
dir=$(dirname "$0")
echo "$*" >> "$dir/argv"
case "$1 $2" in
  "list folders") if [ -e "$dir/folder" ]; then echo '[{"id":"f1","name":"agent-created"}]'; else echo '[]'; fi ;;
  "create folder") base64 -d >> "$dir/stdin"; echo >> "$dir/stdin"; touch "$dir/folder"; echo '{"id":"f1","name":"agent-created"}' ;;
  "generate -ulns") printf 'Zq7#Zq7#Zq7#Zq7#Zq7#Zq7#Zq7#Zq7#\n' ;;
  "create item") base64 -d >> "$dir/stdin"; echo >> "$dir/stdin"; echo '{"id":"new-item","name":"grafana"}' ;;
  *) exit 1 ;;
esac
"#).expect("write stub");
        std::fs::set_permissions(&bw, std::fs::Permissions::from_mode(0o755)).expect("chmod stub");
        let vault = Vault::new(bw.to_string_lossy().into_owned(), "no-agents".to_string(), "agent-created".to_string(), Some(SecretString::from("key")));
        let request = CreateEnvelope {
            name: "grafana".to_string(), username: Some("admin".to_string()), uri: None,
            length: 32, reason: None, session: None, timeout_sec: 60,
        };
        assert_eq!(vault.create(&request).await.as_deref(), Ok("new-item"));
        assert_eq!(vault.create(&request).await.as_deref(), Ok("new-item"));
        let argv = std::fs::read_to_string(dir.join("argv")).expect("argv log");
        assert_eq!(argv.matches("create folder").count(), 1, "{argv}");
        assert!(!argv.contains("Zq7#"), "the password never reaches argv");
        let items: Vec<serde_json::Value> = std::fs::read_to_string(dir.join("stdin")).expect("stdin log").lines()
            .map(|line| serde_json::from_str(line).expect("JSON document")).filter(|value: &serde_json::Value| value["type"] == 1).collect();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["folderId"], "f1");
        assert_eq!(items[0]["login"]["username"], "admin");
        assert_eq!(items[0]["login"]["password"], "Zq7#Zq7#Zq7#Zq7#Zq7#Zq7#Zq7#Zq7#");
        std::fs::remove_dir_all(&dir).ok();
    }
}
