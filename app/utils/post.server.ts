import sortBy from 'sort-by'
import matter from 'gray-matter'
import type {Octokit} from '@octokit/rest'
import type {Post, PostListing, PostFile, PostIndexFile} from 'types'
import {compilePost} from './compile-mdx.server'

async function getPost(slug: string, octokit: Octokit): Promise<Post> {
  const postFiles = await downloadDirectory(octokit, `content/blog/${slug}`)

  const {code, frontmatter} = await compilePost(slug, postFiles)
  return {slug, code, frontmatter: frontmatter as Post['frontmatter']}
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
