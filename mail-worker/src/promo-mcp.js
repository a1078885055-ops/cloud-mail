const tool = {
  name: 'scan_promo_codes',
  description: 'Read one page of received Cloud Mail messages and extract chatgpt.com/p/ promo codes. Never validates or redeems codes. Follow next_cursor until complete; deduplicate codes across pages.',
  inputSchema: {type: 'object', properties: {
    before_id: {type: 'integer', minimum: 0, description: 'Use next_cursor from the previous result; omit for first page.'},
    mailbox: {type: 'string', maxLength: 254, description: 'Optional exact recipient email address.'}
  }, additionalProperties: false},
  annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false}
}

export async function handlePromoMcp(request, env) {
  const headers = {'Cache-Control': 'no-store'}
  if (!env.PROMO_MCP_TOKEN || env.PROMO_MCP_TOKEN.length < 32) {
    return new Response('Integration is not configured', {status: 503, headers})
  }
  const supplied = request.headers.get('Authorization') || ''
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const a = new Uint8Array(await digest(supplied))
  const b = new Uint8Array(await digest(`Bearer ${env.PROMO_MCP_TOKEN}`))
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i]
  if (mismatch) return new Response('Unauthorized', {status: 401, headers})
  if (request.method !== 'POST') return new Response(null, {status: 405, headers: {...headers, Allow: 'POST'}})
  if (!request.headers.get('Content-Type')?.includes('application/json')) return new Response(null, {status: 415, headers})
  const raw = await request.text()
  if (raw.length > 16384) return new Response(null, {status: 413, headers})
  let rpc
  try { rpc = JSON.parse(raw) } catch { return Response.json({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'Parse error'}}, {headers}) }
  const reply = result => Response.json({jsonrpc: '2.0', id: rpc.id ?? null, result}, {headers})
  const error = (code, message) => Response.json({jsonrpc: '2.0', id: rpc?.id ?? null, error: {code, message}}, {headers})
  if (!rpc || Array.isArray(rpc) || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') return error(-32600, 'Invalid Request')
  if (rpc.id === undefined) return new Response(null, {status: 202, headers})
  if (rpc.method === 'initialize') return reply({
    protocolVersion: '2025-03-26', capabilities: {tools: {}}, serverInfo: {name: 'cloud-mail-promo', version: '1.0.0'}
  })
  if (rpc.method === 'ping') return reply({})
  if (rpc.method === 'tools/list') return reply({tools: [tool]})
  if (rpc.method !== 'tools/call') return error(-32601, 'Method not found')
  if (rpc.params?.name !== tool.name) return error(-32602, 'Unknown tool')
  const args = rpc.params.arguments || {}
  const cursor = args.before_id ?? 0
  if (!Number.isSafeInteger(cursor) || cursor < 0 || (args.mailbox !== undefined &&
    (typeof args.mailbox !== 'string' || args.mailbox.length > 254)) ||
    Object.keys(args).some(key => !['before_id', 'mailbox'].includes(key))) return error(-32602, 'Invalid arguments')
  try {
    const conditions = ['type = 0', 'is_del = 0']
    const values = []
    if (cursor) { conditions.push('email_id < ?'); values.push(cursor) }
    if (args.mailbox) { conditions.push('lower(to_email) = lower(?)'); values.push(args.mailbox) }
    const {results} = await env.db.prepare(`SELECT email_id, to_email, create_time, text, content FROM email WHERE ${conditions.join(' AND ')} ORDER BY email_id DESC LIMIT 51`).bind(...values).all()
    const page = results.slice(0, 50)
    const found = new Map()
    for (const mail of page) {
      for (const body of [mail.text, mail.content]) {
        if (typeof body !== 'string') continue
        for (const match of body.matchAll(/https?:\/\/chatgpt\.com\/p\/([a-z0-9_-]+)(?=$|[\s<>"'?#&).,;!])/gi)) {
          const code = match[1]
          if (!found.has(code)) found.set(code, {code, occurrences: [], status: 'unverified'})
          const row = found.get(code)
          if (!row.occurrences.some(item => item.email_id === mail.email_id)) row.occurrences.push({email_id: mail.email_id, mailbox: mail.to_email, received_at: mail.create_time})
        }
      }
    }
    const data = {scanned: page.length, codes: [...found.values()], complete: results.length <= 50,
      next_cursor: results.length > 50 ? page[page.length - 1].email_id : null}
    return reply({content: [{type: 'text', text: JSON.stringify(data)}]})
  } catch {
    return reply({isError: true, content: [{type: 'text', text: 'Mailbox query failed. Check the Worker database binding and schema.'}]})
  }
}
