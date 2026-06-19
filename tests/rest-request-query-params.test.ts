import assert from "node:assert/strict"

import { restRequestPhpCode } from "../packages/runtime-playground/src/rest-request-command-handlers.js"
import { runPhpJson } from "../scripts/test-kit.js"

const generated = restRequestPhpCode({
  method: "GET",
  path: "/wp-json/wp-codebox/v1/browser-blueprint-ref?ref=prepared%3Astudio-proof%3Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  headers: {},
  params: {},
  body: "",
})

const result = await runPhpJson<any>(`
class WP_REST_Request {
	public string $method;
	public string $route;
	public array $params = array();
	public array $headers = array();
	public string $body = '';

	public function __construct( $method, $route ) {
		$this->method = $method;
		$this->route = $route;
	}

	public function set_header( $name, $value ) {
		$this->headers[ $name ] = $value;
	}

	public function set_param( $name, $value ) {
		$this->params[ $name ] = $value;
	}

	public function has_param( $name ) {
		return array_key_exists( $name, $this->params );
	}

	public function set_body( $body ) {
		$this->body = $body;
	}
}

class WP_Codebox_Test_REST_Response {
	private array $data;

	public function __construct( $data ) {
		$this->data = $data;
	}

	public function get_status() {
		return 200;
	}

	public function get_headers() {
		return array();
	}

	public function get_data() {
		return $this->data;
	}
}

function rest_do_request( $request ) {
	return new WP_Codebox_Test_REST_Response(
		array(
			'route' => $request->route,
			'params' => $request->params,
		)
	);
}

function rest_get_server() {
	return new class {
		public function response_to_data( $response, $embed ) {
			return $response->get_data();
		}
	};
}

function wp_json_encode( $data, $flags = 0 ) {
	return json_encode( $data, $flags );
}

${generated}
`)

assert.equal(result.route, "/wp-codebox/v1/browser-blueprint-ref")
assert.equal(result.body.route, "/wp-codebox/v1/browser-blueprint-ref")
assert.equal(result.body.params.ref, "prepared:studio-proof:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

console.log("rest request query params ok")
