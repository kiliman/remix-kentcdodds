import fs from 'fs'
import sortBy from 'sort-by'
import matter from 'gray-matter'
import type {Octokit} from '@octokit/rest'
import type {Post, PostListing, PostFile, PostIndexFile} from 'types'
import {compilePost} from './compile-mdx.server'

async function getPost(slug: string, octokit: Octokit): Promise<Post> {
  let sha = await getSha(octokit, `content/blog/${slug}`)
  // mock appends 'sha' (actually mtimeMs) after path
  if (sha.includes('|')) sha = sha.split('|')[1] as string

  const cacheFile = `${process.env.CACHE_DIR}/${slug}-${sha}.json`
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  }

  const postFiles = await downloadDirectory(octokit, `content/blog/${slug}`)

  const {code, frontmatter} = await compilePost(slug, postFiles)
  const result = {slug, code, frontmatter: frontmatter as Post['frontmatter']}

  fs.writeFileSync(cacheFile, JSON.stringify(result))
  return result
}

function typedBoolean<T>(
  value: T,
): value is Exclude<T, false | null | undefined | '' | 0> {
  return Boolean(value)
}

async function getPosts(octokit: Octokit): Promise<Array<PostListing>> {
  const {data} = await octokit.repos.getContent({
    owner: process.env.BLOG_GITHUB_OWNER as string,
    repo: process.env.BLOG_GITHUB_REPO as string,
    path: process.env.BLOG_GITHUB_PATH as string,
  })
  if (!Array.isArray(data)) throw new Error('Wut github?')

  const result = await Promise.all(
    data
      .filter(({type}) => type === 'dir')
      .map(
        async ({path: fileDir}): Promise<PostIndexFile | null> => {
          const {data: fileData} = await octokit.repos.getContent({
            owner: process.env.BLOG_GITHUB_OWNER as string,
            repo: process.env.BLOG_GITHUB_REPO as string,
            path: fileDir,
          })
          if (!Array.isArray(fileData)) throw new Error('Wut github?')
          const file = fileData.find(
            ({type, path}) =>
              (type === 'file' && path.endsWith('mdx')) || path.endsWith('md'),
          )
          if (!file) {
            console.warn(`No index.md(x?) file for ${fileDir}`)
            return null
          }
          const postFile = await downloadFile(octokit, file.path, file.sha)
          return {...postFile, slug: fileDir.replace('content/blog/', '')}
        },
      ),
  )
  const files = result.filter(typedBoolean)

  const posts = await Promise.all(
    files.map(
      async ({slug, content}): Promise<PostListing> => {
        const matterResult = matter(content)
        const frontmatter = matterResult.data as PostListing['frontmatter']
        return {slug, frontmatter}
      },
    ),
  )

  return posts.sort(sortBy('-frontmatter.published'))
}

// function to get SHA for slug
// unfortunately it's not optimal since there is no GitHub API
// to get SHA for a specfic folder, so need to `getContent` from
// parent folder then filter by path
async function getSha(octokit: Octokit, dir: string): Promise<string> {
  const {data} = await octokit.repos.getContent({
    owner: process.env.BLOG_GITHUB_OWNER as string,
    repo: process.env.BLOG_GITHUB_REPO as string,
    path: process.env.BLOG_GITHUB_PATH as string,
  })
  if (!Array.isArray(data)) throw new Error('Wut github?')
  return data.find(entry => entry.path === dir)?.sha ?? ''
}

async function downloadDirectory(
  octokit: Octokit,
  dir: string,
): Promise<Array<PostFile>> {
  const {data} = await octokit.repos.getContent({
    owner: process.env.BLOG_GITHUB_OWNER as string,
    repo: process.env.BLOG_GITHUB_REPO as string,
    path: dir,
  })
  if (!Array.isArray(data)) throw new Error('Wut github?')

  const result = await Promise.all(
    data.map(async ({path: fileDir, type, sha}) => {
      switch (type) {
        case 'file': {
          return downloadFile(octokit, fileDir, sha)
        }
        case 'dir': {
          return downloadDirectory(octokit, fileDir)
        }
        default: {
          throw new Error(`Unexpected repo file type: ${type}`)
        }
      }
    }),
  )

  return result.flat()
}
async function downloadFile(
  octokit: Octokit,
  path: string,
  sha: string,
): Promise<PostFile> {
  const {data} = await octokit.request(
    'GET /repos/{owner}/{repo}/git/blobs/{file_sha}',
    {
      owner: process.env.BLOG_GITHUB_OWNER as string,
      repo: process.env.BLOG_GITHUB_REPO as string,
      file_sha: sha,
    },
  )
  //                                lol
  const encoding = data.encoding as Parameters<typeof Buffer.from>['1']
  return {path, content: Buffer.from(data.content, encoding).toString()}
}

export {getPost, getPosts}

/*
eslint
  babel/camelcase: "off",
*/
