use axum::{Json, response::Html};
use serde_json::{json, Value};

/// GET /api/openapi.json — machine-readable OpenAPI 3.1 spec
pub async fn openapi_json() -> Json<Value> {
    Json(build_spec())
}

/// GET /api/docs — browser-friendly Swagger UI (CDN)
pub async fn swagger_ui() -> Html<String> {
    Html(r##"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>SSS Backend API Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
SwaggerUIBundle({
  url: "/api/openapi.json",
  dom_id: "#swagger-ui",
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
  layout: "BaseLayout",
  deepLinking: true,
  persistAuthorization: true,
});
</script>
</body>
</html>"##.to_string())
}

fn build_spec() -> Value {
    json!({
      "openapi": "3.1.0",
      "info": {
        "title": "Solana Stablecoin Standard — REST Backend",
        "version": "0.1.0",
        "description": "REST API for the SSS reference backend. Provides mint/burn tracking, supply queries, compliance tools, webhook subscriptions, and API-key management.",
        "contact": { "name": "SSS Team" },
        "license": { "name": "MIT" }
      },
      "servers": [
        { "url": "http://localhost:8080", "description": "Local dev" }
      ],
      "components": {
        "securitySchemes": {
          "ApiKey": {
            "type": "apiKey",
            "in": "header",
            "name": "X-Api-Key",
            "description": "All endpoints except `/api/health` require a valid API key."
          }
        },
        "schemas": {
          "ApiResponse": {
            "type": "object",
            "properties": {
              "success": { "type": "boolean" },
              "data": {},
              "error": { "type": "string", "nullable": true }
            }
          },
          "MintRequest": {
            "type": "object",
            "required": ["token_mint", "amount", "recipient"],
            "properties": {
              "token_mint": { "type": "string", "example": "So11111111111111111111111111111111111111112" },
              "amount": { "type": "integer", "format": "uint64", "minimum": 1 },
              "recipient": { "type": "string" },
              "tx_signature": { "type": "string", "nullable": true }
            }
          },
          "BurnRequest": {
            "type": "object",
            "required": ["token_mint", "amount", "source"],
            "properties": {
              "token_mint": { "type": "string" },
              "amount": { "type": "integer", "format": "uint64", "minimum": 1 },
              "source": { "type": "string" },
              "tx_signature": { "type": "string", "nullable": true }
            }
          },
          "MintEvent": {
            "type": "object",
            "properties": {
              "id": { "type": "string", "format": "uuid" },
              "token_mint": { "type": "string" },
              "amount": { "type": "integer", "format": "uint64" },
              "recipient": { "type": "string" },
              "tx_signature": { "type": "string", "nullable": true },
              "created_at": { "type": "string", "format": "date-time" }
            }
          },
          "BurnEvent": {
            "type": "object",
            "properties": {
              "id": { "type": "string", "format": "uuid" },
              "token_mint": { "type": "string" },
              "amount": { "type": "integer", "format": "uint64" },
              "source": { "type": "string" },
              "tx_signature": { "type": "string", "nullable": true },
              "created_at": { "type": "string", "format": "date-time" }
            }
          },
          "SupplyResponse": {
            "type": "object",
            "properties": {
              "token_mint": { "type": "string" },
              "total_minted": { "type": "integer", "format": "uint64" },
              "total_burned": { "type": "integer", "format": "uint64" },
              "circulating_supply": { "type": "integer", "format": "uint64" }
            }
          },
          "BlacklistRequest": {
            "type": "object",
            "required": ["address", "reason"],
            "properties": {
              "address": { "type": "string" },
              "reason": { "type": "string" }
            }
          },
          "BlacklistEntry": {
            "type": "object",
            "properties": {
              "id": { "type": "string", "format": "uuid" },
              "address": { "type": "string" },
              "reason": { "type": "string" },
              "created_at": { "type": "string", "format": "date-time" }
            }
          },
          "AuditEntry": {
            "type": "object",
            "properties": {
              "id": { "type": "string", "format": "uuid" },
              "action": { "type": "string", "example": "BLACKLIST_ADD" },
              "address": { "type": "string" },
              "details": { "type": "string" },
              "created_at": { "type": "string", "format": "date-time" }
            }
          },
          "WebhookRequest": {
            "type": "object",
            "required": ["url", "events"],
            "properties": {
              "url": { "type": "string", "format": "uri" },
              "events": {
                "type": "array",
                "items": { "type": "string", "enum": ["mint", "burn"] }
              }
            }
          },
          "WebhookEntry": {
            "type": "object",
            "properties": {
              "id": { "type": "string", "format": "uuid" },
              "url": { "type": "string", "format": "uri" },
              "events": { "type": "array", "items": { "type": "string" } },
              "created_at": { "type": "string", "format": "date-time" }
            }
          },
          "ApiKeyEntry": {
            "type": "object",
            "properties": {
              "id": { "type": "string", "format": "uuid" },
              "key": { "type": "string" },
              "label": { "type": "string" },
              "created_at": { "type": "string", "format": "date-time" }
            }
          },
          "CreateApiKeyRequest": {
            "type": "object",
            "required": ["label"],
            "properties": {
              "label": { "type": "string", "example": "my-service" }
            }
          },
          "PageMeta": {
            "type": "object",
            "properties": {
              "total": { "type": "integer" },
              "offset": { "type": "integer" },
              "limit": { "type": "integer" }
            }
          }
        }
      },
      "security": [{ "ApiKey": [] }],
      "paths": {
        "/api/health": {
          "get": {
            "operationId": "getHealth",
            "summary": "Health check",
            "description": "Returns server status. No API key required.",
            "security": [],
            "tags": ["System"],
            "responses": {
              "200": {
                "description": "OK",
                "content": {
                  "application/json": {
                    "schema": {
                      "type": "object",
                      "properties": {
                        "status": { "type": "string", "example": "ok" },
                        "version": { "type": "string" },
                        "timestamp": { "type": "string", "format": "date-time" }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "/api/mint": {
          "post": {
            "operationId": "postMint",
            "summary": "Record a mint event",
            "description": "Records a stablecoin mint. Rejects mint to blacklisted addresses.",
            "tags": ["Supply"],
            "requestBody": {
              "required": true,
              "content": {
                "application/json": {
                  "schema": { "$ref": "#/components/schemas/MintRequest" }
                }
              }
            },
            "responses": {
              "200": { "description": "Mint recorded", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ApiResponse" } } } },
              "400": { "description": "Invalid input or blacklisted address" },
              "401": { "description": "Missing or invalid API key" },
              "429": { "description": "Rate limit exceeded" }
            }
          }
        },
        "/api/burn": {
          "post": {
            "operationId": "postBurn",
            "summary": "Record a burn event",
            "tags": ["Supply"],
            "requestBody": {
              "required": true,
              "content": {
                "application/json": {
                  "schema": { "$ref": "#/components/schemas/BurnRequest" }
                }
              }
            },
            "responses": {
              "200": { "description": "Burn recorded" },
              "400": { "description": "Invalid input" },
              "401": { "description": "Missing or invalid API key" },
              "429": { "description": "Rate limit exceeded" }
            }
          }
        },
        "/api/supply": {
          "get": {
            "operationId": "getSupply",
            "summary": "Query circulating supply",
            "tags": ["Supply"],
            "parameters": [
              { "name": "token_mint", "in": "query", "schema": { "type": "string" }, "description": "Filter by token mint address" }
            ],
            "responses": {
              "200": { "description": "Supply data", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SupplyResponse" } } } },
              "401": { "description": "Missing or invalid API key" }
            }
          }
        },
        "/api/events": {
          "get": {
            "operationId": "getEvents",
            "summary": "List mint and burn events",
            "tags": ["Supply"],
            "parameters": [
              { "name": "token_mint", "in": "query", "schema": { "type": "string" } },
              { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 100 } },
              { "name": "offset", "in": "query", "schema": { "type": "integer", "default": 0 } }
            ],
            "responses": {
              "200": { "description": "Paginated event list with PageMeta" },
              "401": { "description": "Missing or invalid API key" }
            }
          }
        },
        "/api/compliance/blacklist": {
          "get": {
            "operationId": "getBlacklist",
            "summary": "List blacklisted addresses",
            "tags": ["Compliance"],
            "responses": {
              "200": { "description": "Array of BlacklistEntry" },
              "401": { "description": "Missing or invalid API key" }
            }
          },
          "post": {
            "operationId": "addBlacklist",
            "summary": "Add address to blacklist",
            "tags": ["Compliance"],
            "requestBody": {
              "required": true,
              "content": {
                "application/json": {
                  "schema": { "$ref": "#/components/schemas/BlacklistRequest" }
                }
              }
            },
            "responses": {
              "200": { "description": "Entry created" },
              "400": { "description": "Invalid input" },
              "401": { "description": "Missing or invalid API key" }
            }
          }
        },
        "/api/compliance/blacklist/{id}": {
          "delete": {
            "operationId": "removeBlacklist",
            "summary": "Remove address from blacklist",
            "tags": ["Compliance"],
            "parameters": [
              { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
            ],
            "responses": {
              "200": { "description": "Removed" },
              "404": { "description": "Not found" },
              "401": { "description": "Missing or invalid API key" }
            }
          }
        },
        "/api/compliance/audit": {
          "get": {
            "operationId": "getAudit",
            "summary": "Query audit log",
            "tags": ["Compliance"],
            "parameters": [
              { "name": "address", "in": "query", "schema": { "type": "string" } },
              { "name": "action", "in": "query", "schema": { "type": "string" } },
              { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 100 } },
              { "name": "offset", "in": "query", "schema": { "type": "integer", "default": 0 } }
            ],
            "responses": {
              "200": { "description": "Paginated audit entries" },
              "401": { "description": "Missing or invalid API key" }
            }
          }
        },
        "/api/webhooks": {
          "get": {
            "operationId": "listWebhooks",
            "summary": "List webhook subscriptions",
            "tags": ["Webhooks"],
            "responses": {
              "200": { "description": "Array of WebhookEntry" },
              "401": { "description": "Missing or invalid API key" }
            }
          },
          "post": {
            "operationId": "registerWebhook",
            "summary": "Register a webhook",
            "tags": ["Webhooks"],
            "requestBody": {
              "required": true,
              "content": {
                "application/json": { "schema": { "$ref": "#/components/schemas/WebhookRequest" } }
              }
            },
            "responses": {
              "200": { "description": "Webhook registered" },
              "400": { "description": "Invalid input" },
              "401": { "description": "Missing or invalid API key" }
            }
          }
        },
        "/api/webhooks/{id}": {
          "delete": {
            "operationId": "deleteWebhook",
            "summary": "Delete a webhook subscription",
            "tags": ["Webhooks"],
            "parameters": [
              { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
            ],
            "responses": {
              "200": { "description": "Deleted" },
              "404": { "description": "Not found" },
              "401": { "description": "Missing or invalid API key" }
            }
          }
        },
        "/api/admin/keys": {
          "get": {
            "operationId": "listApiKeys",
            "summary": "List API keys",
            "tags": ["Admin"],
            "responses": {
              "200": { "description": "Array of ApiKeyEntry" },
              "401": { "description": "Missing or invalid API key" }
            }
          },
          "post": {
            "operationId": "createApiKey",
            "summary": "Create API key",
            "tags": ["Admin"],
            "requestBody": {
              "required": true,
              "content": {
                "application/json": { "schema": { "$ref": "#/components/schemas/CreateApiKeyRequest" } }
              }
            },
            "responses": {
              "200": { "description": "Created ApiKeyEntry" },
              "401": { "description": "Missing or invalid API key" }
            }
          }
        },
        "/api/admin/keys/{id}": {
          "delete": {
            "operationId": "deleteApiKey",
            "summary": "Delete API key",
            "tags": ["Admin"],
            "parameters": [
              { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
            ],
            "responses": {
              "200": { "description": "Deleted" },
              "404": { "description": "Not found" },
              "401": { "description": "Missing or invalid API key" }
            }
          }
        },
        "/api/docs": {
          "get": {
            "operationId": "getDocs",
            "summary": "Swagger UI",
            "description": "Interactive API documentation (Swagger UI). No API key required.",
            "security": [],
            "tags": ["System"],
            "responses": {
              "200": { "description": "HTML page" }
            }
          }
        },
        "/api/openapi.json": {
          "get": {
            "operationId": "getOpenApiSpec",
            "summary": "OpenAPI 3.1 specification",
            "description": "Returns the machine-readable OpenAPI spec for this API. No API key required.",
            "security": [],
            "tags": ["System"],
            "responses": {
              "200": { "description": "OpenAPI JSON" }
            }
          }
        }
      },
      "tags": [
        { "name": "System", "description": "Health and API documentation" },
        { "name": "Supply", "description": "Mint, burn, supply, and event endpoints" },
        { "name": "Compliance", "description": "Blacklist management and audit log" },
        { "name": "Webhooks", "description": "Webhook subscription management" },
        { "name": "Admin", "description": "API key management" }
      ]
    })
}
