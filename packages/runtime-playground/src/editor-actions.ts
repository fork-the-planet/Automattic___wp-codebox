import { argValue } from "./commands.js"

export interface EditorOpenTarget {
  url: string
  kind: "post" | "post-new" | "site" | "url"
  postId?: number
  postType?: string
  waitSelector: string
}

const DEFAULT_EDITOR_WAIT_SELECTOR = ".edit-post-visual-editor, .editor-styles-wrapper, .block-editor, .interface-interface-skeleton"

export function editorOpenTargetFromArgs(args: string[]): EditorOpenTarget {
  const explicitUrl = argValue(args, "url")?.trim()
  const waitSelector = argValue(args, "wait-selector")?.trim() || DEFAULT_EDITOR_WAIT_SELECTOR
  if (explicitUrl) {
    return { url: explicitUrl, kind: "url", waitSelector }
  }

  const target = argValue(args, "target")?.trim() || "post-new"
  if (target === "site") {
    return { url: "/wp-admin/site-editor.php", kind: "site", waitSelector }
  }

  const postType = argValue(args, "post-type")?.trim() || "post"
  if (!/^[a-zA-Z0-9_-]+$/.test(postType)) {
    throw new Error(`wordpress.editor-open post-type must be a WordPress post type slug: ${postType}`)
  }

  const postIdRaw = argValue(args, "post-id")?.trim()
  if (postIdRaw) {
    const postId = Number.parseInt(postIdRaw, 10)
    if (!Number.isInteger(postId) || postId <= 0) {
      throw new Error(`wordpress.editor-open post-id must be a positive integer: ${postIdRaw}`)
    }
    return { url: `/wp-admin/post.php?post=${postId}&action=edit`, kind: "post", postId, postType, waitSelector }
  }

  if (target !== "post-new") {
    throw new Error(`wordpress.editor-open target supports post-new, site, or url=<path-or-url>: ${target}`)
  }

  return { url: `/wp-admin/post-new.php?post_type=${encodeURIComponent(postType)}`, kind: "post-new", postType, waitSelector }
}
