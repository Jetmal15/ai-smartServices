// Node customization hook (TEST ONLY): Vite replaces `import.meta.env` at build time; Node has no such object. This hook rewrites it to
// `process.env` for the ONE module that reads it (src/lib/appwrite/env.js), so the real browser services can run unchanged in Node.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context)
  if (url.endsWith('/src/lib/appwrite/env.js') && result.source) {
    return { ...result, source: result.source.toString().replaceAll('import.meta.env', 'process.env') }
  }
  return result
}
