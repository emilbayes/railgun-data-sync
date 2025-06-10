import * as ABIs from '@railgun-reloaded/contract-abis'
import { ethers } from 'ethers'
import assert from 'nanoassert'
import UpsertMap from 'upsert-map'

import networkUpgrades from '../upgrades.json'

/**
 *
 * @param a
 * @param b
 */
function min (a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

/**
 *
 * @param start
 * @param end
 * @param step
 */
function * range (start: bigint, end: bigint, step: bigint): Iterable<[bigint, bigint]> {
  let current = start

  while (current <= end) {
    const rangeEnd = min(current + step - 1n, end)
    yield [current, rangeEnd]
    current += step
  }
}

type NetworkUpgrade = {
  address: string
  upgrades: {
    name: 'v1' | 'v2' | 'v2.1'
    from: string
    to: string
    txIndex: number
    txHash: string
  }[]
}

const eth = networkUpgrades.ethereum as NetworkUpgrade

let i = 0
/**
 *
 * @param method
 * @param params
 */
function jsonrpc (method: string, params: any) {
  return {
    jsonrpc: '2.0',
    id: i++,
    method,
    params: [params]
  }
}

const RPC_URL = process.env.RPC_URL
/**
 *
 * @param a
 * @param b
 */
function equalAddress (a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

const chunkSize = 500n
const nameToAbi = new Map([
  ['v1', ABIs.RailgunV1],
  ['v2', ABIs.RailgunV2],
  ['v2.1', ABIs.RailgunV2_1]
])

type TxBatch = {
  blockNumber: bigint
  blockTimestamp: number
  blockHash: string

  transactionIndex: number
  transactionHash: string

  tracePath?: number[]

  origin: string
  from: string

  logs: any[]

  input?: any
}

/**
 *
 */
async function sync () {
  const needTracing = new Set<string>()
  // FIXME: Only doing v1 for now
  for (const upgrade of eth.upgrades.slice(0, 1)) {
    const address = eth.address
    const ABI = nameToAbi.get(upgrade.name)!
    const iface = ethers.Interface.from(ABI)

    const reqQueue = []
    const txLogsMap = new UpsertMap<string, any[]>(() => [], a => a.length === 0)
    for (const [start, end] of range(BigInt(upgrade.from), BigInt(upgrade.to), chunkSize)) {
      const fromBlock = '0x' + start.toString(16)
      const toBlock = '0x' + end.toString(16)

      const filter = {
        fromBlock,
        toBlock,
        address,
        topics: []
      }
      reqQueue.push(jsonrpc('eth_getLogs', filter))

      const data = await req(reqQueue)

      // clear queue
      reqQueue.length = 0

      console.log(`Processing upgrade ${upgrade.name} from block ${start} to ${end}...`)
      if (data.error) {
        console.error(`Error fetching logs: ${data.error.message}`)
        throw new Error(`Failed to fetch logs for upgrade ${upgrade.name}`)
      }

      // first n items of results are txs, the last item is always the logs
      for (const { result: tx } of data.slice(0, -1)) {
        if (tx == null) {
          console.error('Something went wrong here')
          console.dir(data)
        }

        const eoa = equalAddress(tx.to, address)
        const logs = txLogsMap.get(tx.hash)
        assert(logs != null)
        assert(logs.length > 0)

        if (eoa === false) needTracing.add(tx.hash)

        const t: TxBatch = {
          blockNumber: BigInt(tx.blockNumber),
          blockTimestamp: Number(logs[0].blockTimestamp),
          blockHash: tx.blockHash,

          transactionIndex: Number(tx.transactionIndex),
          transactionHash: tx.hash,

          from: eoa ? tx.from : null,
          origin: tx.from,

          logs: logs.map(log => iface.parseLog(log)),

          input: iface.parseTransaction({ data: tx.input })
        }

        txLogsMap.delete(tx.hash)

        console.log(`Processed tx ${t.transactionHash} at block ${t.blockNumber} with ${t.logs.length} logs`)
        console.dir(t)
      }

      data.at(-1)?.result.forEach((log: any) => {
        txLogsMap.upsert(log.transactionHash).push(log)
      })

      for (const txHash of txLogsMap.keys()) {
        reqQueue.push(jsonrpc('eth_getTransactionByHash', txHash))
      }
    }
  }

  console.log(`Need tracing for ${needTracing.size} transactions`)
  console.dir(needTracing, { depth: null })
}

/**
 *
 * @param batch
 * @param tries
 */
async function req (batch: any, tries = 3) {
  if (tries <= 0) throw new Error('Failed to fetch logs after multiple attempts')

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(batch)
  })

  const data = await res.json()

  if (data.error) {
    console.error(`Error fetching logs: ${data.error.message}`)
    await new Promise(resolve => setTimeout(resolve, 1000)) // wait before retrying
    return req(batch, tries - 1)
  }

  return data
}

sync().then(console.log).catch(console.error)
