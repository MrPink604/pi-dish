//! The loopback bridge to pi-dish (TASKS/vault-approvals.md): register a
//! pending request, poll for the operator's decision, heartbeat status.

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use tokio::time::Instant;

use crate::envelope::SessionClaim;

pub const HEADER: &str = "X-Pi-Dish-Vault-Bridge";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Pending,
    Approved,
    Denied,
    Expired,
}

impl Decision {
    fn parse(value: &Value) -> Result<Self, String> {
        match value["status"].as_str() {
            Some("pending") => Ok(Self::Pending),
            Some("approved") => Ok(Self::Approved),
            Some("denied") => Ok(Self::Denied),
            Some("expired") => Ok(Self::Expired),
            other => Err(format!("unexpected status {other:?}")),
        }
    }
}

#[derive(Serialize)]
pub struct Device {
    pub name: String,
    pub fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRequest<'a> {
    pub id: &'a str,
    /// `release` an existing item's fields, or `create` a new login.
    pub action: &'static str,
    pub device: Device,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<&'a str>,
    pub item: &'a str,
    pub fields: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<&'a str>,
    /// The item's Bitwarden folder name (for `release`) or destination folder (for `create`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_uris: Option<&'a [String]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<&'a SessionClaim>,
    pub expires_at: u64,
}

pub struct Bridge {
    http: reqwest::Client,
    base: String,
    token_file: PathBuf,
}

impl Bridge {
    pub fn new(base: String, token_file: PathBuf) -> Self {
        let http = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().unwrap_or_default();
        Self { http, base: base.trim_end_matches('/').to_string(), token_file }
    }

    /// pi-dish creates the token on the first bridge request it sees, so a
    /// missing file reads as empty and that first request is retried once.
    fn token(&self) -> String {
        std::fs::read_to_string(&self.token_file).map(|text| text.trim().to_string()).unwrap_or_default()
    }

    async fn send(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<(u16, Value), String> {
        let mut attempt = 0;
        loop {
            let token = self.token();
            let mut request = self.http.request(method.clone(), format!("{}{path}", self.base)).header(HEADER, &token);
            if let Some(body) = &body {
                request = request.json(body);
            }
            let response = request.send().await.map_err(|e| format!("pi-dish unreachable: {e}"))?;
            let status = response.status().as_u16();
            let value = response.json::<Value>().await.unwrap_or(Value::Null);
            attempt += 1;
            if status == 403 && token.is_empty() && attempt == 1 {
                continue;
            }
            return Ok((status, value));
        }
    }

    fn expect(status: u16, value: &Value, ok: u16) -> Result<(), String> {
        if status == ok {
            return Ok(());
        }
        Err(format!("pi-dish answered {status}: {}", value["error"].as_str().unwrap_or("no detail")))
    }

    pub async fn report_status(&self, state: &str, account: Option<&str>, devices: &[Device]) -> Result<(), String> {
        let (status, value) = self.send(reqwest::Method::POST, "/api/vault/bridge/status", Some(json!({ "state": state, "account": account, "devices": devices }))).await?;
        Self::expect(status, &value, 204)
    }

    pub async fn create(&self, request: &NewRequest<'_>) -> Result<Decision, String> {
        let body = serde_json::to_value(request).map_err(|e| e.to_string())?;
        let (status, value) = self.send(reqwest::Method::POST, "/api/vault/bridge/requests", Some(body)).await?;
        Self::expect(status, &value, 201)?;
        Decision::parse(&value)
    }

    pub async fn poll(&self, id: &str) -> Result<Decision, String> {
        let (status, value) = self.send(reqwest::Method::GET, &format!("/api/vault/bridge/requests/{id}"), None).await?;
        // pi-dish restarted and forgot the request: nobody can approve it now.
        if status == 404 {
            return Ok(Decision::Expired);
        }
        Self::expect(status, &value, 200)?;
        Decision::parse(&value)
    }

    pub async fn abandon(&self, id: &str) {
        let _ = self.send(reqwest::Method::DELETE, &format!("/api/vault/bridge/requests/{id}"), None).await;
    }
}

/// Polls until the request is decided or the deadline passes. Transport
/// errors are retried until the deadline; an undecided request at the
/// deadline is `Expired` (the caller abandons it).
pub async fn await_decision<F, Fut>(first: Decision, deadline: Instant, interval: Duration, mut poll: F) -> Decision
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<Decision, String>>,
{
    let mut current = first;
    while current == Decision::Pending {
        if Instant::now() + interval > deadline {
            return Decision::Expired;
        }
        tokio::time::sleep(interval).await;
        current = poll().await.unwrap_or(Decision::Pending);
    }
    current
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const TICK: Duration = Duration::from_millis(5);

    #[tokio::test]
    async fn returns_the_decision_once_it_arrives_retrying_transient_errors() {
        let polls = Arc::new(AtomicUsize::new(0));
        let counter = polls.clone();
        let decision = await_decision(Decision::Pending, Instant::now() + Duration::from_secs(5), TICK, move || {
            let n = counter.fetch_add(1, Ordering::SeqCst);
            async move {
                match n {
                    0 => Err("pi-dish unreachable".to_string()),
                    1 => Ok(Decision::Pending),
                    _ => Ok(Decision::Denied),
                }
            }
        })
        .await;
        assert_eq!(decision, Decision::Denied);
        assert_eq!(polls.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn an_immediate_grant_does_not_poll() {
        let decision = await_decision(Decision::Approved, Instant::now(), TICK, || async { Ok(Decision::Denied) }).await;
        assert_eq!(decision, Decision::Approved);
    }

    #[tokio::test]
    async fn an_undecided_request_expires_at_the_deadline() {
        let decision = await_decision(Decision::Pending, Instant::now() + Duration::from_millis(30), TICK, || async { Ok(Decision::Pending) }).await;
        assert_eq!(decision, Decision::Expired);
    }

    #[test]
    fn statuses_parse_strictly() {
        assert_eq!(Decision::parse(&json!({ "status": "approved" })), Ok(Decision::Approved));
        assert!(Decision::parse(&json!({ "status": "maybe" })).is_err());
        assert!(Decision::parse(&Value::Null).is_err());
    }

    fn sorted_keys(value: &Value) -> Vec<&str> {
        let mut keys: Vec<&str> = value.as_object().expect("JSON object").keys().map(String::as_str).collect();
        keys.sort_unstable();
        keys
    }

    #[test]
    fn new_request_serializes_exact_camel_case_keys_with_optional_fields() {
        let fields = vec!["username".to_string(), "password".to_string()];
        let uris = vec!["https://portal.acme.com/login".to_string(), "https://status.acme.com".to_string()];
        let session = SessionClaim {
            r#ref: "cu-sandbox/abc123".to_string(),
            name: Some("Portal".to_string()),
            host: Some("cu-sandbox".to_string()),
        };
        let request = NewRequest {
            id: "req-12345678",
            action: "release",
            device: Device { name: "cu-sandbox-proxy".to_string(), fingerprint: "0123456789abcdef".to_string() },
            item_id: Some("item-uuid-1"),
            item: "Acme Portal",
            fields: &fields,
            folder_id: Some("folder-uuid-1"),
            folder: Some("cu-sandbox"),
            origin: Some("https://portal.acme.com"),
            item_uris: Some(&uris),
            reason: Some("sign in"),
            session: Some(&session),
            expires_at: 1_700_000_000_000,
        };
        let value = serde_json::to_value(&request).expect("serializable");
        assert_eq!(
            sorted_keys(&value),
            vec!["action", "device", "expiresAt", "fields", "folder", "folderId", "id", "item", "itemId", "itemUris", "origin", "reason", "session"]
        );
        assert_eq!(value["itemId"], "item-uuid-1");
        assert_eq!(value["folderId"], "folder-uuid-1");
        assert_eq!(value["folder"], "cu-sandbox");
        assert_eq!(value["origin"], "https://portal.acme.com");
        assert_eq!(value["itemUris"], json!(["https://portal.acme.com/login", "https://status.acme.com"]));
        assert_eq!(value["expiresAt"], 1_700_000_000_000u64);
    }

    #[test]
    fn new_request_omits_none_optional_fields() {
        let fields = vec!["password".to_string()];
        let minimal = NewRequest {
            id: "req-12345678",
            action: "release",
            device: Device { name: "desktop".to_string(), fingerprint: "0123456789abcdef".to_string() },
            item_id: None,
            item: "github.com",
            fields: &fields,
            folder_id: None,
            folder: None,
            origin: None,
            item_uris: None,
            reason: None,
            session: None,
            expires_at: 1_700_000_000_000,
        };
        let value = serde_json::to_value(&minimal).expect("serializable");
        assert_eq!(sorted_keys(&value), vec!["action", "device", "expiresAt", "fields", "id", "item"]);

        let create = NewRequest {
            id: "req-create-1",
            action: "create",
            device: Device { name: "desktop".to_string(), fingerprint: "0123456789abcdef".to_string() },
            item_id: None,
            item: "grafana",
            fields: &fields,
            folder_id: None,
            folder: Some("agent-created"),
            origin: None,
            item_uris: None,
            reason: None,
            session: None,
            expires_at: 1_700_000_000_000,
        };
        let create_value = serde_json::to_value(&create).expect("serializable");
        assert_eq!(sorted_keys(&create_value), vec!["action", "device", "expiresAt", "fields", "folder", "id", "item"]);
        assert_eq!(create_value["folder"], "agent-created");

        let empty_uris: Vec<String> = Vec::new();
        let release_empty_uris = NewRequest {
            item_id: Some("item-1"),
            item_uris: Some(&empty_uris),
            ..minimal
        };
        let empty_value = serde_json::to_value(&release_empty_uris).expect("serializable");
        assert_eq!(empty_value["itemId"], "item-1");
        assert_eq!(empty_value["itemUris"], json!([]));
    }
}
