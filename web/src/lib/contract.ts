import { createPublicClient, http, type Address, type Hex } from 'viem'
import { CHAIN } from './chain'

/**
 * Custody contract interface (Trush Network testnet). INTERFACE ONLY for now.
 * TODO fase contrato: deploy the contract, set its address here (or via env), and implement the wrappers.
 * Until then every wrapper is a no-op that reports `simulated: true`, so the UI can show its flow
 * while the database is the only source of truth.
 */
export const CUSTODY_CONTRACT_ADDRESS: Address | null = null

export const custodyAbi = [
  {
    type: 'function',
    name: 'donate',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'foundationId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'donationId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'releaseTranche',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'donationId', type: 'uint256' },
      { name: 'invoiceHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'recordInvoiceHash',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'foundationId', type: 'bytes32' },
      { name: 'hash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'freezeAndRefund',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'foundationId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getReputation',
    stateMutability: 'view',
    inputs: [{ name: 'foundationId', type: 'bytes32' }],
    outputs: [{ name: 'reputation', type: 'uint8' }],
  },
] as const

export interface ContractResult {
  txHash: Hex | null
  /** True while the call is not wired to a deployed contract. */
  simulated: boolean
}

const SIMULATED: ContractResult = { txHash: null, simulated: true }

export const publicClient = createPublicClient({ chain: CHAIN, transport: http() })

/** TODO: approve USDT + call donate(foundationId, amount) from the donor wallet (Privy). */
export async function donate(_foundationId: string, _amount: bigint): Promise<ContractResult> {
  return SIMULATED
}

/** TODO fase agente: auditor wallet calls releaseTranche(donationId, invoiceHash). */
export async function releaseTranche(_donationId: bigint, _invoiceHash: Hex): Promise<ContractResult> {
  return SIMULATED
}

/** TODO: foundation wallet records the invoice file hash on-chain. */
export async function recordInvoiceHash(_foundationId: string, _hash: Hex): Promise<ContractResult> {
  return SIMULATED
}

/** TODO fase agente: auditor wallet freezes the foundation and refunds custody to donors. */
export async function freezeAndRefund(_foundationId: string): Promise<ContractResult> {
  return SIMULATED
}

/** TODO: read the reputation from the contract (publicClient.readContract with custodyAbi). */
export async function getReputation(_foundationId: string): Promise<number | null> {
  return null
}
