use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use reqwest::Client;
use futures_util::StreamExt;

// ─── Shared request type ──────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: serde_json::Value, // string or null
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmStreamRequest {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub messages: Vec<LlmMessage>,
    pub temperature: f32,
    pub stream_event: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmCallRequest {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub messages: serde_json::Value, // full messages array including tool messages
    pub temperature: f32,
    pub tools: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmCallResponse {
    pub content: Option<String>,
    pub tool_calls: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Clone)]
struct StreamChunk {
    delta: String,
    done: bool,
}

// ─── Streaming call (for ask/plan modes) ─────────────────────────────────────

#[tauri::command]
pub async fn llm_complete(app: AppHandle, request: LlmStreamRequest) -> Result<String, String> {
    let base_url = request.base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base_url);

    let client = Client::new();
    let mut req = client.post(&url).header("Content-Type", "application/json");

    if let Some(key) = &request.api_key {
        if !key.is_empty() {
            req = req.bearer_auth(key);
        }
    }

    let body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "temperature": request.temperature,
        "stream": true,
    });

    let response = req
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, text));
    }

    let mut stream = response.bytes_stream();
    let mut full_text = String::new();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            if line.is_empty() || line == "data: [DONE]" {
                continue;
            }

            if let Some(json_str) = line.strip_prefix("data: ") {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                    if let Some(delta) = val
                        .get("choices").and_then(|c| c.get(0))
                        .and_then(|c| c.get("delta"))
                        .and_then(|d| d.get("content"))
                        .and_then(|c| c.as_str())
                    {
                        full_text.push_str(delta);
                        let _ = app.emit(&request.stream_event, StreamChunk {
                            delta: delta.to_string(),
                            done: false,
                        });
                    }
                }
            }
        }
    }

    let _ = app.emit(&request.stream_event, StreamChunk {
        delta: String::new(),
        done: true,
    });

    Ok(full_text)
}

// ─── Non-streaming call (for agent tool-calling loop) ─────────────────────────

#[tauri::command]
pub async fn llm_call(request: LlmCallRequest) -> Result<LlmCallResponse, String> {
    let base_url = request.base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base_url);

    let client = Client::new();
    let mut req = client.post(&url).header("Content-Type", "application/json");

    if let Some(key) = &request.api_key {
        if !key.is_empty() {
            req = req.bearer_auth(key);
        }
    }

    let mut body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "temperature": request.temperature,
        "stream": false,
    });

    if let Some(tools) = &request.tools {
        body["tools"] = tools.clone();
    }

    let response = req
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("JSON parse error: {}", e))?;

    let message = &json["choices"][0]["message"];
    let content = message["content"].as_str().map(|s| s.to_string());
    let tool_calls = if message["tool_calls"].is_array() {
        Some(message["tool_calls"].clone())
    } else {
        None
    };

    Ok(LlmCallResponse { content, tool_calls })
}
