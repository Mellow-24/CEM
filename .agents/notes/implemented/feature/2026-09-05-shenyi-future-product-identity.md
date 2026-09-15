# Agent Note: Shenyi Future product identity

Status: implemented

English | [中文](2026-09-05-shenyi-future-product-identity.zh.md)

## Problem

The Macau Power customer-service demonstration needs a coherent product identity that is distinct from the underlying harness. A title-only rename would leave the browser chrome, navigation, blank conversation state, provider labels, and PWA installation face visibly inconsistent.

## Decision

The user-facing web product is named 深绎未来 (Shenyi Future in English). It uses a 深 character mark, a deep-emerald sidebar, jade interaction colors, and a light mineral content surface. `shenyi-brand.css` follows the platform token sheet and remaps semantic aliases, so product features keep consuming the existing theme vocabulary.

The browser title, PWA manifest, favicon, boot surface, sidebar, blank-session hero, first-use notices, and default provider/model display labels use the new identity. The model route ids, wire model ids, package names, settings namespaces, endpoint variables, and protocol behavior remain unchanged; only their displayed labels change.

## Alternatives considered

Keeping the existing mark while changing copy was rejected because it leaves the source product immediately recognizable. Renaming package and protocol identifiers was rejected because those identifiers are durable configuration and compatibility keys, not presentation text. Per-page color overrides were rejected because they would drift from the existing theme preference and make later feature pages visually inconsistent.

## Consequences

The new visual layer applies consistently to the existing customer-service console and to future settings surfaces. Brand work belongs in the product identity sheet and presentation components; service identifiers remain stable unless a separate compatibility decision explicitly changes them.

## Verification

The affected client bundles are rebuilt, the GUI and web snapshot lanes cover the updated presentation, and the running web page is checked in the browser after restart.
