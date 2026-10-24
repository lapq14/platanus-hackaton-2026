// Libera el tramo inicial de una donación (según reputación) desde la wallet de custodia.
// POST { donation_id }
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { formatEther, parseEther } from 'npm:viem@2'
import { admin, CORS, escrowWallet, json, publicClient } from '../_shared/core.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { donation_id } = await req.json()
    if (!donation_id) return json({ error: 'donation_id requerido' }, 400)

    const { data: donation, error } = await admin
      .from('donations')
      .select('*, foundation:foundations(*)')
      .eq('id', donation_id)
      .single()
    if (error || !donation) return json({ error: 'Donación no encontrada' }, 404)
    if (Number(donation.amount_released) > 0) return json({ error: 'Ya se liberó el tramo inicial' }, 409)
    if (donation.status !== 'in_escrow') return json({ error: `Estado inválido: ${donation.status}` }, 409)

    const f = donation.foundation
    if (f.status === 'suspended') return json({ error: 'Fundación suspendida' }, 403)

    // 1. Verificar on-chain que el depósito realmente llegó a custodia
    const { account, client } = escrowWallet()
    const tx = await publicClient.getTransaction({ hash: donation.deposit_tx_hash })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: donation.deposit_tx_hash })
    const expected = parseEther(String(donation.total_amount))
    if (receipt.status !== 'success') return json({ error: 'El depósito falló on-chain' }, 400)
    if (tx.to?.toLowerCase() !== account.address.toLowerCase()) return json({ error: 'El depósito no fue a custodia' }, 400)
    if (tx.value < expected) return json({ error: 'El monto depositado es menor al registrado' }, 400)

    // 2. Calcular y enviar el tramo inicial a la fundación
    const releaseWei = (expected * BigInt(f.payout_percentage)) / 100n
    const releaseHash = await client.sendTransaction({
      to: f.wallet_address as `0x${string}`,
      value: releaseWei,
    })
    await publicClient.waitForTransactionReceipt({ hash: releaseHash })
    const released = Number(formatEther(releaseWei))

    // 3. Actualizar la DB
    await admin
      .from('donations')
      .update({ amount_released: released, status: 'partially_released' })
      .eq('id', donation_id)
    await admin
      .from('foundations')
      .update({ total_received: Number(f.total_received) + Number(donation.total_amount) })
      .eq('id', f.id)
    await admin.from('verifications').insert({
      donation_id,
      foundation_id: f.id,
      invoice_url: '',
      provider_rif: 'N/A',
      status: 'approved',
      auditor_notes: `Tramo inicial automático (${f.payout_percentage}% por reputación ${f.reputation_score}).`,
      release_tx_hash: releaseHash,
      reviewed_at: new Date().toISOString(),
    })

    return json({ ok: true, released, release_tx_hash: releaseHash, payout_percentage: f.payout_percentage })
  } catch (e) {
    console.error(e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
