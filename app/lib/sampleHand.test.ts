import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScryfallCard } from "~/types";
import type { Deck } from "./deck.ts";
import { drawHand, libraryOf, shuffle } from "./sampleHand.ts";

const lcg = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 2 ** 32
}

const card = (name: string) => ({ name }) as ScryfallCard

const deck: Deck = {
  main: [{ card: card("A"), count: 4 }, { card: card("B"), count: 20 }, { card: card("C"), count: 36 }],
  side: [{ card: card("S"), count: 15 }],
  commander: { card: card("Cmdr"), count: 1 },
}

test("libraryOf has one element per main deck copy", () => {
  const lib = libraryOf(deck)
  assert.equal(lib.length, 60)
  assert.equal(lib.filter(c => c.name === "A").length, 4)
  assert.ok(!lib.some(c => c.name === "S" || c.name === "Cmdr"))
})

test("shuffle keeps every element and leaves its input alone", () => {
  const input = Array.from({ length: 30 }, (_, i) => i)
  const copy = [...input]
  const out = shuffle(input, lcg(1))
  assert.deepEqual(input, copy)
  assert.deepEqual([...out].sort((a, b) => a - b), copy)
})

test("the same seed gives the same order", () => {
  const input = Array.from({ length: 30 }, (_, i) => i)
  assert.deepEqual(shuffle(input, lcg(42)), shuffle(input, lcg(42)))
  assert.notDeepEqual(shuffle(input, lcg(42)), shuffle(input, lcg(43)))
})

test("drawHand deals the hand and keeps the rest", () => {
  const lib = libraryOf(deck)
  const { hand, rest } = drawHand(lib, 7, lcg(7))
  assert.equal(hand.length, 7)
  assert.equal(rest.length, 53)
})

test("a 5-card library gives a 5-card hand", () => {
  const { hand, rest } = drawHand([1, 2, 3, 4, 5], 7, lcg(3))
  assert.equal(hand.length, 5)
  assert.equal(rest.length, 0)
})
