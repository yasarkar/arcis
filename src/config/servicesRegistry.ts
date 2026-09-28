// src/config/servicesRegistry.ts
// Arc Arbitrage and Liquidity x402 AI Services Catalog & Configuration Facade

import type { ServiceManifest, MarketplaceStats } from '../types/marketplace'
import { OFFICIAL_MANIFESTS } from './x402/manifests'

export const DEFAULT_DEMO_PAYER_ADDRESS = '0x360049f5E86E2070f80B0F3Ac9443Bf38e78fC3A'

export const MARKETPLACE_STATS: MarketplaceStats = {
  totalCallsProcessed: 0,
  totalVolumeUsdc: 0.0,
  totalYieldGeneratedUsdc: 0.0,
  averageResponseTimeMs: 120,
  activeServicesCount: 5,
  savedSubscriptionCostUsd: 0.0,
}

// Re-export official manifests under the canonical registry identifier
export const ARC_SERVICES_REGISTRY: ServiceManifest[] = OFFICIAL_MANIFESTS

// Helper functions for code generation
export function generateCurlCode(service: ServiceManifest, payload: Record<string, any>): string {
  const dataString = JSON.stringify(payload, null, 2)
  const endpoint = service.serve.path
  const method = service.serve.method
  const price = service.pricing.priceUsdc

  return `# 1. Step: Unpaid Probe (Returns HTTP 402 + Payment Requirements)
curl -i -X ${method} "${endpoint}" \\
  -H "Content-Type: application/json"

# 2. Step: x402 Authorized Call (Nanopayment Settled via Gateway / Arc L1)
curl -X ${method} "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: x402-Gateway-V1 payer=0xYOUR_WALLET,amount=${price},sig=0xSIGNATURE" \\
  -d '${dataString}'`
}

export function generateTypescriptCode(service: ServiceManifest, payload: Record<string, any>): string {
  const endpoint = service.serve.path
  const method = service.serve.method
  const price = service.pricing.priceUsdc

  return `import { createPublicClient, http } from 'viem'

// Arcis x402 Client Execution
async function call${service.name.replace(/[^a-zA-Z0-9]/g, '')}() {
  const endpoint = "${endpoint}";
  const payload = ${JSON.stringify(payload, null, 2)};

  // 1. Send Probe
  const probe = await fetch(endpoint, {
    method: "${method}",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (probe.status === 402) {
    const paymentHeader = probe.headers.get("x-payment-amount"); // "${price} USDC"
    console.log("⚡ 402 Challenge received. Signing nanopayment of ${price} USDC...");
    
    // 2. Sign Nanopayment off-chain & execute
    const res = await fetch(endpoint, {
      method: "${method}",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer x402_signed_gateway_token"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log("✨ Response received in <150ms:", data);
    return data;
  }
}

call${service.name.replace(/[^a-zA-Z0-9]/g, '')}();`
}

export function generatePythonCode(service: ServiceManifest, payload: Record<string, any>): string {
  const endpoint = service.serve.path
  const price = service.pricing.priceUsdc

  return `import requests
import json

# Arcis x402 Nanopayment LangChain / Python Tool Integration
def execute_${service.id.replace(/-/g, '_')}():
    url = "${endpoint}"
    headers = {
        "Content-Type": "application/json",
        "X-Payer-Address": "0xYourArcWalletAddress",
        "X-Max-USDC-Budget": "${price}"
    }
    payload = ${JSON.stringify(payload, null, 4)}

    # Send Request with automatic Gateway Nanopayments settlement
    response = requests.post(url, headers=headers, json=payload)
    
    if response.status_code == 200:
        alpha_data = response.json()
        print("✅ Received Alpha Data from Arcis x402 Hub:")
        print(json.dumps(alpha_data, indent=2))
        return alpha_data
    else:
        print(f"Error {response.status_code}: {response.text}")

if __name__ == "__main__":
    execute_${service.id.replace(/-/g, '_')}()`
}
