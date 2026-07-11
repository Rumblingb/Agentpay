---
post_id: linkedin-003-ledger-build
channel: linkedin
handle: Rajiv Baskaran
status: STAGED
published_url: null
published_via: null
date: null
char_count: 315
audience: engineering leadership / build-in-public
gate: action_time_approval
destination_id: cmossyk7o0001szlrcuao3zxu
---

**A design system is not a Figma file.**

This week we shipped a real one.

At AgentPay Labs, we had three React Native apps in various stages of review. Each had been styled by hand. No shared tokens. No consistent motion. Purple was everywhere because it was the default.

We replaced all of that with Ledger:

- Ink ground (#1a1a1a) instead of white
- Bone text (#f2f2f2) for every label
- Signal amber (#d97706) for CTAs only
- Fraunces display with italic amber emphasis

It sounds like a style choice. It's an operations choice.

Now when I change a token, I know exactly which app files resolve. When we generate App Store screenshots through the web screenshot pipeline, the same metro config and the same react-native-web build serve two stores from one source of truth.

The game engine (Power Cabinet) was rebuilt with the same Ledger tokens. The landing worker (agentpay.so) runs the same palette. Three apps, one repo, one design language.

Most teams ship UI changes as exceptions. We built a system that makes them defaults.

📦 github.com/Rumblingb/
