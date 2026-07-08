"""KeyStoneOS shared core — pure decision/validation logic used by activities.

These modules carry NO side effects and NO tool calls (CLAUDE.md §0): they
decide and validate. The activities (one tool each) and the Rust control-plane
import this logic so the One Rule is enforced identically everywhere.
"""
