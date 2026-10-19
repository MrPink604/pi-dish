//! Persistent listener identity and paired connections under the state
//! directory (default `~/.pi/dish/vault/`, 0700; files 0600).
//!
//! Adapted from agent-access v0.11.0 `crates/ap-cli/src/storage`
//! (Copyright Bitwarden Inc, Apache-2.0): same formats, explicit directory
//! and owner-only permissions.

use std::fs;
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

use ap_client::{ClientError, ConnectionInfo, ConnectionStore, ConnectionUpdate, IdentityProvider};
use ap_noise::{MultiDeviceTransport, PersistentTransportState};
use ap_proxy_protocol::{IdentityFingerprint, IdentityKeyPair};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

pub fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)
}

/// Writes through a 0600 temp file and a rename, so readers never see half a file.
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    {
        let mut file = fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)
}

pub struct FileIdentity {
    keypair: IdentityKeyPair,
}

#[async_trait]
impl IdentityProvider for FileIdentity {
    async fn identity(&self) -> IdentityKeyPair {
        self.keypair.clone()
    }
}

impl FileIdentity {
    pub fn load_or_generate(dir: &Path) -> Result<Self, ClientError> {
        let path = dir.join("identity.key");
        let fail = |e: String| ClientError::IdentityStorageFailed(e);
        let keypair = if path.exists() {
            let bytes = fs::read(&path).map_err(|e| fail(format!("read {}: {e}", path.display())))?;
            IdentityKeyPair::from_cose(&bytes).map_err(|_| fail(format!("unreadable identity in {}", path.display())))?
        } else {
            let keypair = IdentityKeyPair::generate();
            write_private(&path, &keypair.to_cose()).map_err(|e| fail(format!("write {}: {e}", path.display())))?;
            keypair
        };
        Ok(Self { keypair })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConnectionRecord {
    remote_fingerprint: IdentityFingerprint,
    cached_at: u64,
    last_connected_at: u64,
    #[serde(default)]
    transport_state: Option<Vec<u8>>,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct ConnectionCacheData {
    connections: Vec<ConnectionRecord>,
}

fn record_to_info(record: &ConnectionRecord) -> Result<ConnectionInfo, ClientError> {
    let transport_state = match &record.transport_state {
        Some(bytes) => Some(PersistentTransportState::from_bytes(bytes).map(MultiDeviceTransport::from)?),
        None => None,
    };
    Ok(ConnectionInfo {
        fingerprint: record.remote_fingerprint,
        name: record.name.clone(),
        cached_at: record.cached_at,
        last_connected_at: record.last_connected_at,
        transport_state,
    })
}

fn info_to_record(info: &ConnectionInfo) -> Result<ConnectionRecord, ClientError> {
    let transport_state = match &info.transport_state {
        Some(transport) => Some(
            PersistentTransportState::from(transport)
                .to_bytes()
                .map_err(|e| ClientError::NoiseProtocol(format!("Failed to serialize transport state: {e}")))?,
        ),
        None => None,
    };
    Ok(ConnectionRecord {
        remote_fingerprint: info.fingerprint,
        cached_at: info.cached_at,
        last_connected_at: info.last_connected_at,
        transport_state,
        name: info.name.clone(),
    })
}

/// Paired agent hosts. The UserClient owns the live instance; heartbeats and
/// request labelling read a fresh copy from disk.
pub struct FileConnections {
    path: PathBuf,
    data: ConnectionCacheData,
}

impl FileConnections {
    pub fn load(dir: &Path) -> Result<Self, ClientError> {
        let path = dir.join("connections.json");
        let data = if path.exists() {
            let text = fs::read_to_string(&path).map_err(|e| ClientError::ConnectionCache(format!("read {}: {e}", path.display())))?;
            serde_json::from_str(&text).map_err(|e| ClientError::ConnectionCache(format!("parse {}: {e}", path.display())))?
        } else {
            ConnectionCacheData::default()
        };
        Ok(Self { path, data })
    }

    fn persist(&self) -> Result<(), ClientError> {
        let json = serde_json::to_vec_pretty(&self.data).map_err(|e| ClientError::ConnectionCache(format!("serialize: {e}")))?;
        write_private(&self.path, &json).map_err(|e| ClientError::ConnectionCache(format!("write {}: {e}", self.path.display())))
    }

    /// (name, fingerprint hex) for every paired device.
    pub fn devices(&self) -> Vec<(String, String)> {
        self.data
            .connections
            .iter()
            .map(|record| (record.name.clone().unwrap_or_else(|| "unnamed device".to_string()), record.remote_fingerprint.to_hex()))
            .collect()
    }

    pub fn name_of(&self, fingerprint: &IdentityFingerprint) -> Option<String> {
        self.data.connections.iter().find(|record| record.remote_fingerprint == *fingerprint).and_then(|record| record.name.clone())
    }
}

#[async_trait]
impl ConnectionStore for FileConnections {
    async fn get(&self, fingerprint: &IdentityFingerprint) -> Option<ConnectionInfo> {
        self.data
            .connections
            .iter()
            .find(|record| record.remote_fingerprint == *fingerprint)
            .and_then(|record| record_to_info(record).ok())
    }

    async fn save(&mut self, connection: ConnectionInfo) -> Result<(), ClientError> {
        let record = info_to_record(&connection)?;
        match self.data.connections.iter_mut().find(|existing| existing.remote_fingerprint == connection.fingerprint) {
            Some(existing) => *existing = record,
            None => self.data.connections.push(record),
        }
        self.persist()
    }

    async fn update(&mut self, update: ConnectionUpdate) -> Result<(), ClientError> {
        let Some(record) = self.data.connections.iter_mut().find(|record| record.remote_fingerprint == update.fingerprint) else {
            return Err(ClientError::ConnectionCache("Connection not found".to_string()));
        };
        record.last_connected_at = update.last_connected_at;
        self.persist()
    }

    async fn list(&self) -> Vec<ConnectionInfo> {
        self.data.connections.iter().filter_map(|record| record_to_info(record).ok()).collect()
    }
}
