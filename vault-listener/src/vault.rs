//! The unlocked Bitwarden vault, through the `bw` CLI. The session key lives
//! only in this process's memory and reaches `bw` children through their
//! environment; it is never logged or written.

use std::sync::RwLock;

use ap_client::CredentialData;
use secrecy::{ExposeSecret, SecretString};
use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use zeroize::Zeroizing;

use crate::envelope::custom_field;

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
    session: RwLock<Option<SecretString>>,
}

impl Vault {
    pub fn new(bw: String, deny_folder: String, session: Option<SecretString>) -> Self {
        Self { bw, deny_folder, session: RwLock::new(session) }
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

    /// The id of the folder agents may never see, if it exists.
    async fn denied_folder(&self) -> Result<Option<String>, String> {
        let folders: Vec<BwFolder> = serde_json::from_slice(&self.run(&["list", "folders"]).await?).map_err(|e| format!("unexpected bw output: {e}"))?;
        Ok(folders.into_iter().find(|folder| folder.name.as_deref() == Some(self.deny_folder.as_str())).and_then(|folder| folder.id))
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
    /// refusal when it sits in the deny folder. The document stays in memory
    /// only until the request is answered.
    pub async fn prepare(&self, item: &str) -> Result<Prepared, String> {
        if !self.is_unlocked() {
            return Err("the vault is locked".to_string());
        }
        let document = Zeroizing::new(self.run(&["get", "item", item]).await?);
        let summary: BwSummary = serde_json::from_slice(&document).map_err(|e| format!("unexpected bw output: {e}"))?;
        if let (Some(folder), Some(denied)) = (summary.folder_id.as_deref(), self.denied_folder().await?) {
            if folder == denied {
                return Err(format!("the item is in the \"{}\" folder", self.deny_folder));
            }
        }
        let name = summary.name.unwrap_or_else(|| item.to_string());
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
}
