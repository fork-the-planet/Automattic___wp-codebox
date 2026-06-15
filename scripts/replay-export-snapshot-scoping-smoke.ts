import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRuntime } from "@automattic/wp-codebox-core"
import { createPlaygroundRuntimeBackend } from "@automattic/wp-codebox-playground"

const artifactsDirectory = await mkdtemp(join(tmpdir(), "wp-codebox-replay-export-scope-"))

try {
  const runtime = await createRuntime(
    {
      backend: "wordpress-playground",
      environment: { kind: "wordpress", name: "replay-export-snapshot-scoping-smoke", version: "7.0", blueprint: { steps: [] } },
      policy: {
        network: "deny",
        filesystem: "readwrite-mounts",
        commands: ["wordpress.run-php", "wordpress.wp-cli", "wordpress.export-replay-package"],
        secrets: "none",
        approvals: "never",
      },
      artifactsDirectory,
    },
    createPlaygroundRuntimeBackend(),
  )

  try {
    await runtime.execute({ command: "wordpress.wp-cli", args: ["command=post create --post_type=page --post_status=publish --post_title='Replay Included Page' --porcelain"] })
    await runtime.execute({ command: "wordpress.wp-cli", args: ["command=post create --post_type=post --post_status=publish --post_title='Replay Excluded Post' --porcelain"] })
    await runtime.execute({
      command: "wordpress.run-php",
      args: [
        "code=update_option('wp_codebox_scope_keep', 'yes'); update_option('wp_codebox_scope_drop', 'no'); file_put_contents(WP_CONTENT_DIR . '/scope-keep.txt', 'keep'); file_put_contents(WP_CONTENT_DIR . '/scope-drop.txt', 'drop');",
      ],
    })

    const exportResult = await runtime.execute({
      command: "wordpress.export-replay-package",
      args: [
        "snapshot-include-wp-content=scope-keep.txt",
        "snapshot-database-tables=posts,postmeta,options",
        "snapshot-option-names=wp_codebox_scope_keep",
        "snapshot-post-types=page",
      ],
    })
    const output = JSON.parse(exportResult.stdout)
    assert.deepEqual(output.snapshotOptions, {
      includedWpContentPaths: ["scope-keep.txt"],
      includedDatabaseTables: ["posts", "postmeta", "options"],
      includedOptionNames: ["wp_codebox_scope_keep"],
      includedPostTypes: ["page"],
    })

    const snapshot = JSON.parse(await readFile(join(output.directory, output.artifacts.snapshot), "utf8"))
    assert.deepEqual(snapshot.metadata.includedWpContentPaths, ["scope-keep.txt"])
    assert.deepEqual(snapshot.metadata.includedDatabaseTables, ["options", "postmeta", "posts"])
    assert.deepEqual(snapshot.metadata.includedOptionNames, ["wp_codebox_scope_keep"])
    assert.deepEqual(snapshot.metadata.includedPostTypes, ["page"])
    assert.deepEqual(snapshot.files.map((file: { path: string }) => file.path), ["scope-keep.txt"])

    const tableNames = snapshot.database.tables.map((table: { name: string }) => table.name.replace(/^wp_/, "")).sort()
    assert.deepEqual(tableNames, ["options", "postmeta", "posts"])

    const optionsTable = snapshot.database.tables.find((table: { name: string }) => table.name.endsWith("options"))
    const optionNames = optionsTable.rows.map((row: { option_name: string }) => row.option_name)
    assert.deepEqual(optionNames, ["wp_codebox_scope_keep"])

    const postsTable = snapshot.database.tables.find((table: { name: string }) => table.name.endsWith("posts"))
    const postTitles = postsTable.rows.map((row: { post_title: string }) => row.post_title)
    assert.equal(postTitles.includes("Replay Included Page"), true)
    assert.equal(postTitles.includes("Replay Excluded Post"), false)

    const notes = JSON.parse(await readFile(join(output.directory, output.artifacts.notes), "utf8"))
    assert.deepEqual(notes.source.snapshotOptions, output.snapshotOptions)

    console.log("replay-export-snapshot-scoping-smoke passed")
  } finally {
    await runtime.destroy()
  }
} finally {
  await rm(artifactsDirectory, { recursive: true, force: true })
}
