# Cookbook recipes

Recipes that exercise realistic surface area, intended as starting points for
adopters whose first non-toy attempt to use WP Codebox is "test my plugin
against bbPress" or "drive my theme against seeded content."

These are not internal correctness fixtures (the recipes in
`examples/recipes/*.json` cover that). They are product fixtures: each one
mounts a target plugin or theme, seeds a realistic host context via Playground
blueprint steps, and is intended to be paired with `--preview-hold` for visual
smoke testing.

## Available recipes

### `bbpress-reply-editor.json`

Boots a Playground with bbPress installed from `wordpress.org/plugins`, mounts
your plugin under test, seeds one forum and one topic, and auto-logs in as
admin. Pair with `--preview-hold` and navigate the preview URL from the seed
output to land on the bbPress reply form.

**Replace** the `inputs.mounts[0].source` value in the recipe with the path
to the plugin you want to exercise against bbPress. The default points at
`../../simple-plugin` so the recipe runs out of the box, but the interesting
mount target is whatever editor-or-reply-handling plugin you're debugging.

```bash
# Edit examples/recipes/cookbook/bbpress-reply-editor.json:
#   "source": "../../path/to/your-plugin"
#
# Then:
npm run wp-codebox -- recipe-run \
  --recipe ./examples/recipes/cookbook/bbpress-reply-editor.json \
  --preview-hold 30m \
  --json
```

The seed step's JSON output includes the preview URLs for the seeded reply
form.

#### Why this exists

The motivating use case was debugging a runtime regression in
[Extra-Chill/blocks-everywhere](https://github.com/Extra-Chill/blocks-everywhere)
after a major refactor (removing the bundled isolated-block-editor dependency).
Two production deploys to extrachill.com broke the bbPress reply editor because
the change had never been runtime-tested against a real bbPress host page. A
sandbox recipe that boots bbPress + the plugin under test + a seeded topic is
exactly the smoke-test surface that would have caught the regression before
release.

This recipe is the generalized version of that smoke test. Drop in any plugin
that hooks the bbPress reply editor surface and the preview URL gives you a
real reply form to click into.

#### Extending

The seed step is intentionally small. If you need additional bbPress shape
(multiple forums, nested replies, custom user roles, additional topics with
varying content shapes), edit `bbpress-reply-editor-seed.php` to add them
before the JSON output line, or fork the recipe entirely.

### `woocommerce-store.json`

Boots a Playground with WooCommerce installed from `wordpress.org/plugins`,
mounts your plugin under test, seeds a small store, and auto-logs in as admin.
The fixture data includes standard store pages, three simple products, one
customer, and one processing order so product, cart, checkout, order, and common
WooCommerce hook integrations have real data to inspect.

**Replace** the `inputs.mounts[0].source` value in the recipe with the path to
the plugin you want to exercise against WooCommerce. The default points at
`../../simple-plugin` so the recipe runs out of the box, but the interesting
mount target is whatever WooCommerce integration you're debugging.

```bash
# Edit examples/recipes/cookbook/woocommerce-store.json:
#   "source": "../../path/to/your-plugin"
#
# Then:
npm run wp-codebox -- recipe-run \
  --recipe ./examples/recipes/cookbook/woocommerce-store.json \
  --preview-hold 30m \
  --json
```

The seed step's JSON output includes storefront URLs for the shop, cart,
checkout, account page, first product, and admin URLs for orders. Use the shop
URL for storefront smoke testing, the checkout URL for payment/cart flows, and
the order admin URL for integrations that render order meta or admin hooks.

#### Why this exists

WooCommerce is a high-value non-toy host shape for WordPress plugin authors.
Many integrations need products, carts, checkout pages, orders, customers, and
WooCommerce hooks before their runtime behavior is visible. This recipe gives
that shape without parent-site snapshots or production data.

#### Extending

The seed step is fixture-only and intentionally small. If you need additional
WooCommerce shape (variable products, coupons, subscriptions, custom gateways,
tax classes, shipping zones, or more order statuses), edit
`woocommerce-store-seed.php` to add them before the JSON output line, or fork
the recipe entirely.
