//! Verifies that Cursor model catalogs contain only locally configured BYOK models.
#[path = "support/fake_provider.rs"]
mod fake_provider;
#[path = "support/fixtures.rs"]
mod fixtures;

use std::sync::Arc;

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use cursor_server::{
    api::cursor,
    cursor::{
        prompting::{PromptAssets, PromptCompiler},
        protocol::proto::agent::v1 as agent,
        transport::TransportRegistry,
    },
    model::{ModelConfigInput, ModelType, OPENAI_CHAT_ENDPOINT},
    network::NetworkClients,
    store::Store,
};
use prost::Message;
use tower::ServiceExt;

const CATALOG_PATHS: [&str; 3] = [
    "/aiserver.v1.AiService/AvailableModels",
    "/agent.v1.AgentService/GetUsableModels",
    "/aiserver.v1.AiService/GetUsableModels",
];

#[derive(Clone, PartialEq, Message)]
struct AvailableModelsResponse {
    #[prost(string, repeated, tag = "1")]
    model_names: Vec<String>,
    #[prost(message, repeated, tag = "2")]
    models: Vec<AvailableModel>,
}

#[derive(Clone, PartialEq, Message)]
struct AvailableModel {
    #[prost(string, tag = "1")]
    name: String,
    #[prost(bool, tag = "2")]
    default_on: bool,
}

fn catalog_router(store: Store) -> axum::Router {
    let assets = PromptAssets::load(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("prompt/cursor")
            .as_path(),
    )
    .unwrap();
    let clients = NetworkClients::new(store.clone());
    let registry = TransportRegistry::new(
        store,
        Arc::new(fake_provider::FakeProvider::default()),
        PromptCompiler::new(assets),
    );
    cursor::router(registry, clients).unwrap()
}

fn model_input(model_id: &str) -> ModelConfigInput {
    ModelConfigInput {
        sort_order: 0,
        display_name: model_id.into(),
        group_name: None,
        model_type: ModelType::OpenAi,
        base_url: "https://provider.example/v1".into(),
        use_full_url: false,
        api_key: "provider-secret".into(),
        tooltip_data: String::new(),
        model_id: model_id.into(),
        reasoning_effort: None,
        openai_endpoint: OPENAI_CHAT_ENDPOINT.into(),
        openai_extra_params_enabled: false,
        openai_extra_params: serde_json::json!({}),
        custom_headers_enabled: false,
        custom_headers: serde_json::json!({}),
        anthropic_extra_params_enabled: false,
        anthropic_extra_params: serde_json::json!({}),
        context_window_tokens: None,
        max_completion_tokens: None,
        anthropic_max_tokens: None,
        anthropic_thinking_effort: None,
        thinking_budget_tokens: None,
    }
}

async fn assert_catalog(router: axum::Router, path: &str, expected_ids: &[String]) {
    let response = router
        .oneshot(
            Request::post(path)
                .header(header::CONTENT_TYPE, "application/proto")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK, "{path}");
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/proto");
    let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    if path == CATALOG_PATHS[0] {
        let catalog = AvailableModelsResponse::decode(body).unwrap();
        assert_eq!(catalog.model_names, expected_ids, "{path}");
        assert_eq!(
            catalog
                .models
                .iter()
                .map(|model| &model.name)
                .collect::<Vec<_>>(),
            expected_ids.iter().collect::<Vec<_>>(),
            "{path}"
        );
        assert!(catalog.models.iter().all(|model| model.default_on));
    } else {
        let catalog = agent::GetUsableModelsResponse::decode(body).unwrap();
        assert_eq!(
            catalog
                .models
                .iter()
                .map(|model| &model.model_id)
                .collect::<Vec<_>>(),
            expected_ids.iter().collect::<Vec<_>>(),
            "{path}"
        );
    }
}

#[tokio::test]
async fn catalogs_return_only_configured_byok_models() {
    let (_directory, store) = fixtures::temp_store().await;
    let first = store.create_model(&model_input("first-model")).await.unwrap();
    let mut second_input = model_input("second-model");
    second_input.sort_order = 1;
    let second = store.create_model(&second_input).await.unwrap();
    let router = catalog_router(store);
    let expected_ids = [first.model_hash, second.model_hash];

    for path in CATALOG_PATHS {
        assert_catalog(router.clone(), path, &expected_ids).await;
    }
}

#[tokio::test]
async fn empty_catalogs_do_not_fall_back_to_official_models() {
    let (_directory, store) = fixtures::temp_store().await;
    let router = catalog_router(store);

    for path in CATALOG_PATHS {
        assert_catalog(router.clone(), path, &[]).await;
    }
}
