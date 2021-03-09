import * as nodePath from 'path'
import * as fs from 'fs/promises'
import {rest} from 'msw'
import {setupServer} from 'msw/node'

type GHContentsDescription = {
  name: string
  path: string
  sha: string
  size: number
  url: string
  html_url: string
  git_url: string
  download_url: string | null
  type: 'dir' | 'file'
  _links: {
    self: string
    git: string
    html: string
  }
}

type GHContent = {
  sha: string
  node_id: string
  size: number
  url: string
  content: string
  encoding: 'base64'
}

async function calcMtime(
  fullPath: string,
  maxMtime: number = 0,
): Promise<number> {
  const stat = await fs.stat(fullPath)
  if (stat.isDirectory()) {
    const entries = await fs.readdir(fullPath)
    let max = maxMtime
    for (let i = 0; i < entries.length; i++) {
      const path = entries[i]
      // eslint-disable-next-line no-await-in-loop
      max = await calcMtime(`${fullPath}/${path}`, max)
    }
    return max
  } else {
    return Math.max(maxMtime, stat.mtimeMs)
  }
}

const handlers = [
  rest.get(
    `https://api.github.com/repos/:owner/:repo/contents/:path`,
    async (req, res, ctx) => {
      const {owner, repo} = req.params
      const path = decodeURIComponent(req.params.path).trim()
      const dir = nodePath.join(__dirname, '..', path)
      const dirList = await fs.readdir(dir)

      const contentDescriptions = await Promise.all(
        dirList.map(
          async (name): Promise<GHContentsDescription> => {
            const relativePath = nodePath.join(path, name)
            const fullPath = nodePath.join(dir, name)
            const stat = await fs.stat(fullPath)
            // NOTE: this is a cheat-code so we don't have to determine the sha of the file
            // and our sha endpoint handler doesn't have to do a reverse-lookup.
            const isDir = stat.isDirectory()
            const mtimeMs = await calcMtime(fullPath)
            const sha = `${relativePath}|${mtimeMs}`
            const size = isDir ? 0 : stat.size
            return {
              name,
              path: relativePath,
              sha,
              size,
              url: `https://api.github.com/repos/${owner}/${repo}/contents/${path}?${req.url.searchParams}`,
              html_url: `https://github.com/${owner}/${repo}/tree/main/content/blog/2010s-decade-in-review`,
              git_url: `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}`,
              download_url: null,
              type: isDir ? 'dir' : 'file',
              _links: {
                self: `https://api.github.com/repos/${owner}/${repo}/contents/content/blog/2010s-decade-in-review${req.url.searchParams}`,
                git: `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}`,
                html: `https://github.com/${owner}/${repo}/tree/main/content/blog/2010s-decade-in-revie`,
              },
            }
          },
        ),
      )

      return res(ctx.json(contentDescriptions))
    },
  ),
  rest.get(
    `https://api.github.com/repos/:owner/:repo/git/blobs/:sha`,
    async (req, res, ctx) => {
      const {owner, repo} = req.params
      const sha = decodeURIComponent(req.params.sha).trim()
      // NOTE: we cheat a bit and in the contents/:path handler, we set the sha to the relativePath
      const [relativePath] = sha.split('|')

      if (!relativePath) {
        throw new Error(`Unable to find the file for the sha ${sha}`)
      }

      const fullPath = nodePath.join(__dirname, '..', relativePath)
      const encoding = 'base64' as const
      const size = (await fs.stat(fullPath)).size
      const resource: GHContent = {
        sha,
        node_id: `${sha}_node_id`,
        size,
        url: `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
        content: await fs.readFile(fullPath, {encoding}),
        encoding,
      }
      return res(ctx.json(resource))
    },
  ),
]
const server = setupServer(...handlers)

server.listen({onUnhandledRequest: 'error'})
console.log('🔶 Mock server installed')

process.once('SIGINT', server.close)
process.once('SIGTERM', server.close)
