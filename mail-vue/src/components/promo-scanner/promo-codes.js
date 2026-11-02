// Read strings only: never render email HTML or request redemption URLs.
export function extractPromoCodes(...bodies) {
  const codes = new Set()
  for (const body of bodies) {
    if (typeof body !== 'string') continue
    const pattern = /https?:\/\/chatgpt\.com\/p\/([a-z0-9_-]+)(?=$|[\s<>"'?#&).,;!])/gi
    for (const match of body.matchAll(pattern)) codes.add(match[1])
  }
  return [...codes]
}
