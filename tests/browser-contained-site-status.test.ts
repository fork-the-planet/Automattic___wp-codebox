import assert from "node:assert/strict"

import { phpStringLiteral, repoRoot, runPhpJson } from "../scripts/test-kit.js"

const result = await runPhpJson<any>(`
define('ABSPATH', ${phpStringLiteral(repoRoot)});

class WP_Error {
	public function __construct( public string $code = '', public string $message = '', public array $data = array() ) {}
}
function is_wp_error( $value ) { return $value instanceof WP_Error; }
function sanitize_key( $value ) { return strtolower( preg_replace( '/[^a-zA-Z0-9_-]/', '', (string) $value ) ); }
function wp_create_nonce( $action = -1 ) { return 'test-rest-nonce'; }

$GLOBALS['wp_codebox_test_transients'] = array();
function get_transient( $key ) { return $GLOBALS['wp_codebox_test_transients'][ $key ] ?? false; }

require ${phpStringLiteral(`${repoRoot}/packages/wordpress-plugin/src/class-wp-codebox-browser-task-builder.php`)};
require ${phpStringLiteral(`${repoRoot}/packages/wordpress-plugin/src/trait-wp-codebox-abilities-browser-runtime.php`)};
require ${phpStringLiteral(`${repoRoot}/packages/wordpress-plugin/src/trait-wp-codebox-abilities-browser-blueprint.php`)};
require ${phpStringLiteral(`${repoRoot}/packages/wordpress-plugin/src/trait-wp-codebox-abilities-execution.php`)};

class WP_Codebox_Test_Browser_Contained_Site_Abilities {
	use WP_Codebox_Abilities_Browser_Runtime;
	use WP_Codebox_Abilities_Browser_Blueprint;
	use WP_Codebox_Abilities_Execution;
}

$cache_key = 'studio-proof';
$input_hash = str_repeat( 'c', 64 );
$transient_key = 'wp_codebox_browser_prepared_runtime_' . substr( hash( 'sha256', $cache_key . ':' . $input_hash ), 0, 24 );
$GLOBALS['wp_codebox_test_transients'][ $transient_key ] = array(
	'schema' => 'wp-codebox/browser-prepared-runtime-artifact/v1',
	'cache_key' => $cache_key,
	'input_hash' => $input_hash,
	'created_at' => '2026-06-18T00:00:00+00:00',
	'blueprint' => array( 'steps' => array( array( 'step' => 'login' ) ) ),
);

$hit = WP_Codebox_Test_Browser_Contained_Site_Abilities::get_browser_contained_site_status( array(
	'contained_site' => array(
		'site_id' => $cache_key,
		'source_digest' => array( 'algorithm' => 'sha256', 'value' => $input_hash ),
		'recovery' => array( 'input' => array( 'cache_key' => $cache_key, 'input_hash' => $input_hash ) ),
	),
) );
$miss = WP_Codebox_Test_Browser_Contained_Site_Abilities::get_browser_contained_site_status( array(
	'site_id' => $cache_key,
	'input_hash' => str_repeat( 'd', 64 ),
) );

echo json_encode( array( 'hit' => $hit, 'miss' => $miss ), JSON_UNESCAPED_SLASHES );
`)

assert.equal(result.hit.schema, "wp-codebox/browser-contained-site-status/v1")
assert.equal(result.hit.success, true)
assert.equal(result.hit.site_id, "studio-proof")
assert.equal(result.hit.status, "recoverable")
assert.equal(result.hit.source_digest.value, "c".repeat(64))
assert.equal(result.hit.blueprint_ref.ref, `prepared:studio-proof:${"c".repeat(64)}`)
assert.equal(result.miss.success, false)
assert.equal(result.miss.status, "miss")

console.log("browser contained site status ok")
