import assert from "node:assert/strict"

import { phpStringLiteral, repoRoot, runPhpJson } from "../scripts/test-kit.js"

const result = await runPhpJson<any>(`
define('ABSPATH', ${phpStringLiteral(repoRoot)});

$GLOBALS['wp_codebox_test_actions'] = array();
$GLOBALS['wp_codebox_test_filters'] = array();

function add_action( $hook, $callback, $priority = 10, $accepted_args = 1 ) {
	$GLOBALS['wp_codebox_test_actions'][] = array( 'hook' => $hook, 'callback' => $callback, 'priority' => $priority, 'accepted_args' => $accepted_args );
}

function add_filter( $hook, $callback, $priority = 10, $accepted_args = 1 ) {
	$GLOBALS['wp_codebox_test_filters'][] = array( 'hook' => $hook, 'callback' => $callback, 'priority' => $priority, 'accepted_args' => $accepted_args );
}

require ${phpStringLiteral(`${repoRoot}/packages/wordpress-plugin/src/class-wp-codebox-abilities.php`)};
require ${phpStringLiteral(`${repoRoot}/packages/wordpress-plugin/src/class-wp-codebox-browser-task-builder.php`)};

function wp_create_nonce( $action = -1 ) {
	return 'test-rest-nonce';
}

new WP_Codebox_Abilities();

$blueprint_ref = WP_Codebox_Browser_Task_Builder::browser_blueprint_ref(
	array(
		'cache_key'  => 'studio-proof',
		'input_hash' => str_repeat( 'a', 64 ),
	)
);

echo json_encode( array( 'actions' => $GLOBALS['wp_codebox_test_actions'], 'filters' => $GLOBALS['wp_codebox_test_filters'], 'blueprint_ref' => $blueprint_ref ), JSON_UNESCAPED_SLASHES );
`)

assert.equal(result.actions.some((entry: any) => entry.hook === "rest_api_init" && entry.callback?.[1] === "register_rest_routes"), true)
assert.equal(result.filters.some((entry: any) => entry.hook === "rest_pre_dispatch" && entry.callback?.[1] === "rest_handle_browser_callback_cors_preflight"), true)
assert.equal(result.filters.some((entry: any) => entry.hook === "rest_pre_serve_request" && entry.callback?.[1] === "rest_send_browser_callback_cors_headers"), true)
assert.match(result.blueprint_ref.hydration_endpoint, /[?&]_wpnonce=test-rest-nonce(?:&|$)/)

console.log("rest route registration ok")
