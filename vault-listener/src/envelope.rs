//! The request envelope `pi-dish-vault run` puts in the aac `Domain` query
//! (TASKS/vault-approvals.md): `pidish-vault:v1:` + base64url(JSON).

use ap_client::CredentialQuery;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};

pub const PREFIX: &str = "pidish-vault:v1:";
/// `pi-dish-vault pair` sends this query once to complete pairing: aac
/// v0.11.0 pairs non-interactively only as part of a credential request. It is
/// answered with an empty credential and never reaches pi-dish.
pub const PAIR_PROBE: &str = "pidish-vault:pair";
/// `pi-dish-vault search` sends `pidish-vault:search:` + base64url(query). The
/// listener answers it itself with item names, ids and URIs (never values),
/// as JSON in the credential's `notes`.
pub const SEARCH_PREFIX: &str = "pidish-vault:search:";
/// `pi-dish-vault sync` sends this query. The listener answers it itself,
/// without approval: `bw sync`, then an empty credential, or a refusal when
/// the vault is locked or the sync fails.
pub const SYNC_PROBE: &str = "pidish-vault:sync";
/// `pi-dish-vault run` sends `pidish-vault:check:` + the request's base64url
/// JSON after aac reports a refusal. The listener answers it itself, without
/// approval, with `{"ok":true}` or `{"error":"<why>"}` as JSON in `notes`.
pub const CHECK_PREFIX: &str = "pidish-vault:check:";
/// `pi-dish-vault create` sends `pidish-vault:create:` + base64url JSON naming a
/// new login. The listener generates the password itself (it never travels
/// from the agent host), asks pi-dish, and on approval creates the item in its
/// create folder. The reply's `notes` carry `{"id","name","folder"}` or
/// `{"error":"<why>"}` for a refusal before approval; a decision other than
/// approval is a denied request.
pub const CREATE_PREFIX: &str = "pidish-vault:create:";
pub const DEFAULT_PASSWORD_LENGTH: u8 = 32;
pub const MIN_PASSWORD_LENGTH: u8 = 16;
pub const MAX_PASSWORD_LENGTH: u8 = 128;
const MAX_NAME: usize = 256;
const MAX_LOGIN_TEXT: usize = 1024;

/// The search text of a search probe; `None` for any other query.
pub fn search_query(query: &CredentialQuery) -> Option<Result<String, String>> {
    let encoded = query.search_string().trim().strip_prefix(SEARCH_PREFIX)?;
    Some(
        URL_SAFE_NO_PAD
            .decode(encoded.trim_end_matches('='))
            .map_err(|e| format!("bad search encoding: {e}"))
            .and_then(|bytes| String::from_utf8(bytes).map_err(|e| format!("bad search text: {e}")))
            .map(|text| text.trim().to_string()),
    )
}

pub const FIELDS: [&str; 5] = ["username", "password", "totp", "uri", "notes"];
/// `field:<name>` asks for the custom (text or hidden) field `<name>` of the item.
pub const CUSTOM_PREFIX: &str = "field:";
const MAX_CUSTOM_NAME: usize = 128;

/// The custom field name of a `field:<name>` request; `None` for built-ins.
pub fn custom_field(field: &str) -> Option<&str> {
    field.strip_prefix(CUSTOM_PREFIX)
}

fn valid_field(field: &str) -> bool {
    match custom_field(field) {
        Some(name) => !name.is_empty() && name.chars().count() <= MAX_CUSTOM_NAME && !name.chars().any(char::is_control),
        None => FIELDS.contains(&field),
    }
}
/// Login fields released to a stock `aac` query that names no fields.
const LOGIN_FIELDS: [&str; 4] = ["username", "password", "totp", "uri"];
/// A bare aac query waits up to aac's own 120 s default; answer before it.
pub const DEFAULT_TIMEOUT_SEC: u64 = 110;
pub const MAX_TIMEOUT_SEC: u64 = 600;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionClaim {
    pub r#ref: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Envelope {
    pub item: String,
    /// Distinct: built-ins in [`FIELDS`] order, then `field:<name>` entries as requested.
    pub fields: Vec<String>,
    pub reason: Option<String>,
    pub session: Option<SessionClaim>,
    pub timeout_sec: u64,
}

#[derive(Deserialize)]
struct Wire {
    item: String,
    fields: Vec<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    session: Option<SessionClaim>,
    #[serde(default, rename = "timeoutSec")]
    timeout_sec: Option<u64>,
}

/// Distinct valid fields, built-ins in canonical order then custom fields as
/// requested; `None` when empty, repeated or unknown.
pub fn canonical_fields(fields: &[String]) -> Option<Vec<String>> {
    if fields.is_empty() || fields.iter().any(|field| !valid_field(field)) {
        return None;
    }
    let mut seen: Vec<String> = Vec::new();
    for field in fields {
        if seen.contains(field) {
            return None;
        }
        seen.push(field.clone());
    }
    let builtin = FIELDS.iter().filter(|field| seen.iter().any(|s| s == *field)).map(|field| (*field).to_string());
    let custom = seen.iter().filter(|field| custom_field(field).is_some()).cloned();
    Some(builtin.chain(custom).collect())
}

/// Decodes a request. A query without the pi-dish prefix (stock `aac`) asks
/// for the login fields of the named item, with no session or reason.
pub fn decode(query: &CredentialQuery) -> Result<Envelope, String> {
    let value = query.search_string().trim();
    let Some(encoded) = value.strip_prefix(PREFIX) else {
        if value.is_empty() {
            return Err("empty query".to_string());
        }
        return Ok(Envelope {
            item: value.to_string(),
            fields: LOGIN_FIELDS.iter().map(|field| (*field).to_string()).collect(),
            reason: None,
            session: None,
            timeout_sec: DEFAULT_TIMEOUT_SEC,
        });
    };
    decode_wire(encoded)
}

/// The request a check probe asks about; `None` for any other query.
pub fn check_query(query: &CredentialQuery) -> Option<Result<Envelope, String>> {
    query.search_string().trim().strip_prefix(CHECK_PREFIX).map(decode_wire)
}

fn decode_wire(encoded: &str) -> Result<Envelope, String> {
    let bytes = URL_SAFE_NO_PAD.decode(encoded.trim_end_matches('=')).map_err(|e| format!("bad envelope encoding: {e}"))?;
    let wire: Wire = serde_json::from_slice(&bytes).map_err(|e| format!("bad envelope JSON: {e}"))?;
    let item = wire.item.trim().to_string();
    if item.is_empty() {
        return Err("envelope names no item".to_string());
    }
    let fields = canonical_fields(&wire.fields).ok_or_else(|| format!("fields must be distinct values from {}, {CUSTOM_PREFIX}<name>", FIELDS.join(", ")))?;
    let reason = wire.reason.map(|reason| reason.trim().to_string()).filter(|reason| !reason.is_empty());
    let session = wire.session.filter(|session| !session.r#ref.trim().is_empty());
    let timeout_sec = wire.timeout_sec.unwrap_or(DEFAULT_TIMEOUT_SEC).clamp(10, MAX_TIMEOUT_SEC);
    Ok(Envelope { item, fields, reason, session, timeout_sec })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateEnvelope {
    pub name: String,
    pub username: Option<String>,
    pub uri: Option<String>,
    pub length: u8,
    pub reason: Option<String>,
    pub session: Option<SessionClaim>,
    pub timeout_sec: u64,
}

impl CreateEnvelope {
    /// The fields the new item will have, as the approval card lists them.
    pub fn fields(&self) -> Vec<String> {
        [("username", self.username.is_some()), ("password", true), ("uri", self.uri.is_some())]
            .into_iter()
            .filter(|(_, present)| *present)
            .map(|(field, _)| field.to_string())
            .collect()
    }
}

#[derive(Deserialize)]
struct CreateWire {
    name: String,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    uri: Option<String>,
    #[serde(default)]
    length: Option<u8>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    session: Option<SessionClaim>,
    #[serde(default, rename = "timeoutSec")]
    timeout_sec: Option<u64>,
}

/// A short single-line value, `None` when absent or blank.
fn login_text(value: Option<String>, what: &str, max: usize) -> Result<Option<String>, String> {
    let Some(text) = value.map(|text| text.trim().to_string()).filter(|text| !text.is_empty()) else { return Ok(None) };
    if text.chars().count() > max || text.chars().any(char::is_control) {
        return Err(format!("{what} must be one line of at most {max} characters"));
    }
    Ok(Some(text))
}

/// The new item a create request names; `None` for any other query.
pub fn create_query(query: &CredentialQuery) -> Option<Result<CreateEnvelope, String>> {
    let encoded = query.search_string().trim().strip_prefix(CREATE_PREFIX)?;
    Some(decode_create(encoded))
}

fn decode_create(encoded: &str) -> Result<CreateEnvelope, String> {
    let bytes = URL_SAFE_NO_PAD.decode(encoded.trim_end_matches('=')).map_err(|e| format!("bad create encoding: {e}"))?;
    let wire: CreateWire = serde_json::from_slice(&bytes).map_err(|e| format!("bad create JSON: {e}"))?;
    let name = login_text(Some(wire.name), "name", MAX_NAME)?.ok_or_else(|| "the new item needs a name".to_string())?;
    let username = login_text(wire.username, "username", MAX_LOGIN_TEXT)?;
    let uri = login_text(wire.uri, "uri", MAX_LOGIN_TEXT)?;
    let length = wire.length.unwrap_or(DEFAULT_PASSWORD_LENGTH);
    if !(MIN_PASSWORD_LENGTH..=MAX_PASSWORD_LENGTH).contains(&length) {
        return Err(format!("length must be {MIN_PASSWORD_LENGTH}-{MAX_PASSWORD_LENGTH}"));
    }
    let reason = wire.reason.map(|reason| reason.trim().to_string()).filter(|reason| !reason.is_empty());
    let session = wire.session.filter(|session| !session.r#ref.trim().is_empty());
    let timeout_sec = wire.timeout_sec.unwrap_or(DEFAULT_TIMEOUT_SEC).clamp(10, MAX_TIMEOUT_SEC);
    Ok(CreateEnvelope { name, username, uri, length, reason, session, timeout_sec })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn domain(json: &str) -> CredentialQuery {
        CredentialQuery::Domain(format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(json)))
    }

    #[test]
    fn decodes_a_full_envelope() {
        let query = domain(r#"{"item":"fleet-sudo-desktop","fields":["password","username"],"reason":"install","session":{"ref":"desktop/01a0a845","name":"Htpc","host":"desktop"},"timeoutSec":300}"#);
        let envelope = decode(&query).expect("valid envelope");
        assert_eq!(envelope.item, "fleet-sudo-desktop");
        assert_eq!(envelope.fields, vec!["username", "password"]);
        assert_eq!(envelope.reason.as_deref(), Some("install"));
        assert_eq!(envelope.session.map(|s| s.r#ref), Some("desktop/01a0a845".to_string()));
        assert_eq!(envelope.timeout_sec, 300);
    }

    #[test]
    fn custom_fields_follow_the_built_ins_in_request_order() {
        let envelope = decode(&domain(r#"{"item":"x","fields":["field:api key","notes","field:Token","password"]}"#)).expect("valid envelope");
        assert_eq!(envelope.fields, vec!["password", "notes", "field:api key", "field:Token"]);
    }

    #[test]
    fn padded_base64_and_missing_options_are_accepted() {
        let encoded = base64::engine::general_purpose::URL_SAFE.encode(r#"{"item":"x","fields":["notes"]}"#);
        let envelope = decode(&CredentialQuery::Domain(format!("{PREFIX}{encoded}"))).expect("valid envelope");
        assert_eq!(envelope.fields, vec!["notes"]);
        assert_eq!(envelope.reason, None);
        assert_eq!(envelope.session, None);
        assert_eq!(envelope.timeout_sec, DEFAULT_TIMEOUT_SEC);
    }

    #[test]
    fn timeouts_are_clamped() {
        assert_eq!(decode(&domain(r#"{"item":"x","fields":["password"],"timeoutSec":99999}"#)).expect("valid").timeout_sec, MAX_TIMEOUT_SEC);
        assert_eq!(decode(&domain(r#"{"item":"x","fields":["password"],"timeoutSec":1}"#)).expect("valid").timeout_sec, 10);
    }

    #[test]
    fn a_stock_query_asks_for_login_fields() {
        let envelope = decode(&CredentialQuery::Domain("github.com".to_string())).expect("plain query");
        assert_eq!(envelope.item, "github.com");
        assert_eq!(envelope.fields, vec!["username", "password", "totp", "uri"]);
        assert_eq!(decode(&CredentialQuery::Id("abc-123".to_string())).expect("id query").item, "abc-123");
    }

    #[test]
    fn malformed_envelopes_are_rejected() {
        assert!(decode(&CredentialQuery::Domain(format!("{PREFIX}!!!"))).is_err());
        assert!(decode(&domain("not json")).is_err());
        assert!(decode(&domain(r#"{"item":" ","fields":["password"]}"#)).is_err());
        assert!(decode(&domain(r#"{"item":"x","fields":[]}"#)).is_err());
        assert!(decode(&domain(r#"{"item":"x","fields":["ssn"]}"#)).is_err());
        assert!(decode(&domain(r#"{"item":"x","fields":["field:"]}"#)).is_err());
        assert!(decode(&domain(r#"{"item":"x","fields":["field:a\nb"]}"#)).is_err());
        assert!(decode(&domain(r#"{"item":"x","fields":["field:k","field:k"]}"#)).is_err());
        assert!(decode(&domain(r#"{"item":"x","fields":["password","password"]}"#)).is_err());
        assert!(decode(&CredentialQuery::Domain("  ".to_string())).is_err());
    }

    #[test]
    fn search_probes_are_recognized_and_decoded() {
        let probe = CredentialQuery::Domain(format!("{SEARCH_PREFIX}{}", URL_SAFE_NO_PAD.encode(" github ")));
        assert_eq!(search_query(&probe), Some(Ok("github".to_string())));
        assert_eq!(search_query(&CredentialQuery::Domain(SEARCH_PREFIX.to_string())), Some(Ok(String::new())));
        assert!(matches!(search_query(&CredentialQuery::Domain(format!("{SEARCH_PREFIX}!!!"))), Some(Err(_))));
        assert_eq!(search_query(&CredentialQuery::Domain("github.com".to_string())), None);
    }

    #[test]
    fn check_probes_carry_a_request() {
        let probe = CredentialQuery::Domain(format!("{CHECK_PREFIX}{}", URL_SAFE_NO_PAD.encode(r#"{"item":"hf","fields":["password"]}"#)));
        let request = check_query(&probe).expect("a check probe").expect("valid request");
        assert_eq!((request.item.as_str(), request.fields), ("hf", vec!["password".to_string()]));
        assert!(check_query(&domain(r#"{"item":"hf","fields":["password"]}"#)).is_none());
    }

    #[test]
    fn create_requests_list_the_fields_of_the_new_item() {
        let probe = |json: &str| CredentialQuery::Domain(format!("{CREATE_PREFIX}{}", URL_SAFE_NO_PAD.encode(json)));
        let request = create_query(&probe(r#"{"name":" grafana admin ","uri":"https://g.lan","reason":"set up","timeoutSec":120}"#)).expect("a create").expect("valid");
        assert_eq!(request.name, "grafana admin");
        assert_eq!(request.fields(), vec!["password", "uri"]);
        assert_eq!((request.length, request.timeout_sec), (DEFAULT_PASSWORD_LENGTH, 120));
        assert!(create_query(&probe(r#"{"name":" "}"#)).expect("a create").is_err());
        assert!(create_query(&probe(r#"{"name":"x","length":8}"#)).expect("a create").is_err());
        assert!(create_query(&probe(r#"{"name":"x","username":"a\nb"}"#)).expect("a create").is_err());
        assert!(create_query(&domain(r#"{"item":"x","fields":["password"]}"#)).is_none());
    }
}
