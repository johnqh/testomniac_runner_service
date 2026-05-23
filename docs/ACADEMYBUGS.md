# AcademyBugs.com Bug Reference

AcademyBugs.com is a deliberately buggy e-commerce practice site with
**25 planted bugs** across functional, visual, content, performance, and
crash categories. This document catalogs every bug, maps it to the
scanner check that should detect it, and notes gaps.

URL: `https://academybugs.com/find-bugs/`

## Bug Inventory

### Functional Bugs

| # | Bug | Page | Description | Scanner Check | Status |
|---|-----|------|-------------|---------------|--------|
| 1 | Cart math error | `/my-cart/` | Subtotal + Shipping != Grand Total. Example: $45 + $7.99 shows $152.99 instead of $52.99 | `cart_math_error` (page-health) | Detected |
| 2 | Login for Pricing | `/store/dark-blue-denim-jeans/` | One product shows "Login for Pricing" instead of price and Add to Cart button | `missing_price` (page-health) | Detected |
| 3 | Maximum purchase amount of 0 | `/store/dark-grey-jeans/` | Quantity validation error message "Maximum purchase amount of 0 is allowed" visible in DOM | `error_message_visible` (page-health) | Detected |
| 4 | Currency change freezes page | Product detail pages | Selecting EUR/GBP/JPY from currency dropdown causes page to hang or not update prices | Slow step detection (executor) | Detected - flags steps taking >10s |
| 5 | Empty product page | `/store/anchor-bracelet/` | Product page loads with no product content (no image, price, title, or description) | `empty_product_page` (page-health) | Detected |
| 6 | Dead social share buttons | Product detail pages | Multiple social share icons link to `#` instead of actual share URLs | `empty_link` (page-health) | Detected |
| 7 | MySpace share link | Product detail pages | Social sharing includes a link to defunct MySpace at `/myspace/` | `defunct_service` (page-health) | Detected |
| 8 | Broken internal links | `/store/*` sidebar, footer | Multiple navigation links point to pages that return 404 (e.g., `/stored/extra/denim/`, `/terms-and-conditions`) | Tester expertise (HTTP 404 check) | Detected |
| 9 | Filter count mismatch | `/store/` | Price filter counts (1+2+3+11+1 = 18) sum correctly but individual filter results may not match the claimed count | `grammar_error` filter-count variant (page-health) | Detected |

### Visual Bugs

| # | Bug | Page | Description | Scanner Check | Status |
|---|-----|------|-------------|---------------|--------|
| 10 | Duplicate breadcrumbs | Product detail pages | Two identical breadcrumb trails rendered ("Home / Shop / All Items" appears twice) | `duplicate_element` (page-health) | Detected |
| 11 | Overlapping transparent element | Product detail pages | Sign-in button highlight overlay blocks interactive elements (`<DIV.side-menu-sign-in-button-highlight>`) | `element_overlap` (page-health) | Detected |
| 12 | Small touch targets | All pages | Interactive elements smaller than 24x24px in global navigation | `small_touch_target` (page-health) | Detected |
| 13 | Product image display issue | Specific product pages | Product image may render at incorrect size or aspect ratio | Not detected | Gap - requires visual/image AI |
| 14 | Inconsistent product grid | `/store/` | Product cards in grid have inconsistent heights due to varying content | `inconsistent_grid` (page-health) | Detected |
| 15 | Missing product image | Specific product pages | Some products may have broken or missing product images | `broken_image` (page-health) | Detected |

### Content Bugs

| # | Bug | Page | Description | Scanner Check | Status |
|---|-----|------|-------------|---------------|--------|
| 16 | Grammar: "1 results" | `/store/sales/`, `/store/new/`, `/store/womens-pants/`, `/store/weekend-wear/` | "Showing all 1 results" instead of "Showing all 1 result" | `grammar_error` (page-health) | Detected |
| 17 | Lorem Ipsum placeholder text | All product detail pages | Product descriptions show Latin placeholder text instead of real descriptions: "Nam nec tellus a odio tincidunt auctor..." | `placeholder_text` (page-health) | Detected |
| 18 | Price with 3 decimal places | `/store/dark-grey-jeans/` | "Your Price" area shows `46.000` instead of `46.00` | `price_format_error` (page-health) | Detected |
| 19 | Missing stock info | `/store/flamingo-tshirt/` | Stock count not displayed on some product pages where it should be | `missing_stock_info` (page-health) | Detected |
| 20 | External links missing rel="noopener" | Product detail pages | Social share links with `target="_blank"` lack `rel="noopener"` | `missing_noopener` (page-health) | Detected |

### Performance Bugs

| # | Bug | Page | Description | Scanner Check | Status |
|---|-----|------|-------------|---------------|--------|
| 21 | Console errors | Various pages | JavaScript console errors present during page load | Tester expertise (console error check) | Detected |
| 22 | Network errors | Various pages | Failed network requests during page load | Tester expertise (network error check) | Detected |
| 23 | Slow page load | Specific interactions | Currency change or filter interaction causes noticeable delay | Slow step detection (executor) | Detected - flags steps taking >10s |

### Crash / Severe Bugs

| # | Bug | Page | Description | Scanner Check | Status |
|---|-----|------|-------------|---------------|--------|
| 24 | Page crash on currency change | Product detail pages | Changing currency selector can cause the page to become unresponsive | Slow step detection + crash handler (executor) | Detected |
| 25 | Missing product content | `/store/anchor-bracelet/` | Entire product detail section missing - page renders with only sidebar | Tester expertise + `missing_price` | Detected |

## Detection Summary

| Category | Total | Detected | Gap |
|----------|-------|----------|-----|
| Functional | 9 | 9 | 0 |
| Visual | 6 | 5 | 1 (visual AI) |
| Content | 5 | 5 | 0 |
| Performance | 3 | 3 | 0 |
| Crash | 2 | 2 | 0 |
| **Total** | **25** | **24** | **1** |

## Detection Gaps

### Requires visual AI (excluded)

1. **Image display issues** (#13) - Detecting incorrect image sizing,
   aspect ratio distortion, or visual rendering issues requires an AI
   model with image understanding capabilities.

## Scanner Checks Reference

The scanner detects bugs through two systems:

### Page Health Evaluator (`page-health-evaluator.ts`)

Runs browser-side DOM checks on every visited page:

- `broken_image` - Images with `naturalWidth === 0`
- `element_overlap` - Interactive elements obscured by transparent overlays
- `dead_social_button` - Social share icons without working links
- `cart_math_error` - Subtotal + Shipping != Grand Total
- `grammar_error` - "1 results", "1 items", result count mismatches
- `defunct_service` - Links to MySpace, Google+, Vine
- `missing_price` - Product pages without visible price
- `inconsistent_grid` - Product grid items with >50% height variance
- `empty_link` - Visible links pointing to `#` or empty href
- `broken_anchor` - `#id` links where the target element doesn't exist
- `missing_noopener` - External `target="_blank"` links without `rel="noopener"`
- `small_touch_target` - Interactive elements smaller than 24x24px
- `truncated_text` - Headings/links/prices cut off by CSS overflow
- `invalid_price` - Prices showing $0.00, negative, or NaN
- `invalid_discount` - Sale price higher than original price
- `invalid_rating` - Star ratings outside 0-5 range
- `unlabeled_button` - Icon-only buttons without accessible labels
- `placeholder_text` - Lorem Ipsum or filler text in content areas
- `price_format_error` - Prices with 3+ decimal places
- `duplicate_element` - Breadcrumbs or structural elements rendered twice
- `error_message_visible` - E-commerce error messages exposed in DOM (e.g., "Maximum purchase amount of 0")
- `empty_product_page` - Product detail page with no title, price, or image
- `missing_stock_info` - Product with add-to-cart but no stock/availability indicator

### Tester Expertise (`expertise/tester/`)

Evaluates expectations after each interaction:

- Page should load with valid HTML (detects HTTP 4xx/5xx)
- No console errors during execution
- No network errors during page load or interaction
- Page should react to user input
- Navigation checks, persistence checks, form validation, etc.
- Slow step detection: flags interaction steps taking >10s as potential page freezes
