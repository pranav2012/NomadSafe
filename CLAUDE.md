# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NomadSafe is a cross-platform mobile app built with Expo (SDK 54), React Native 0.81, and React 19. Uses TypeScript in strict mode.

## Commands

- **Install deps**: `pnpm install`
- **Start dev server**: `pnpm start`
- **Run on iOS**: `pnpm ios`
- **Run on Android**: `pnpm android`
- **Run on web**: `pnpm web`
- **Lint**: `pnpm lint`

Package manager is **pnpm** (not npm/yarn).

## Architecture

- **Routing**: Expo Router (file-based routing) — files in `app/` define routes
  - `app/_layout.tsx` — root layout (Stack navigator)
  - `app/index.tsx` — home screen (`/`)
- **Path alias**: `@/` maps to project root (configured in tsconfig.json)
- **Navigation**: `@react-navigation/native` with `@react-navigation/bottom-tabs`
- **No state management library** yet — using React built-ins
- **No test framework** configured yet

## Key Config

- **New Architecture** enabled (Fabric + TurboModules)
- **React Compiler** (experimental) enabled
- **Typed routes** enabled — route names are type-checked
- **Bundle IDs**: `com.pranav2012.NomadSafe` (iOS & Android)
- **ESLint**: flat config extending `eslint-config-expo`
- **VS Code**: auto-fix, organize imports, sort members on save
