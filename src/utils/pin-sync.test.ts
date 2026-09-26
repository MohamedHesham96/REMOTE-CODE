import { describe, expect, it } from "vitest"
import { createPinSyncGate } from "./pin-sync"

// البثّ من السيرفر (جهاز تاني/نافذة تانية) ضد التعديل المحلي اللي في الطريق:
// التعديل المحلي يسبّب لحد ما طلبه يوصل، وبعدين أحدث قائمة من السيرفر تفوز.
describe("pin sync gate", () => {
  it("applies a broadcast right away when nothing is in flight", () => {
    const gate = createPinSyncGate()
    expect(gate.isPending()).toBe(false)
    expect(gate.broadcast(["a"])).toEqual(["a"])
    expect(gate.isPending()).toBe(false)
  })

  it("holds a broadcast that arrives while a request is still going", () => {
    const gate = createPinSyncGate()
    gate.start()
    expect(gate.isPending()).toBe(true)
    expect(gate.broadcast(["a"])).toBeNull()
  })

  it("releases the held broadcast once the request settles", () => {
    const gate = createPinSyncGate()
    gate.start()
    gate.broadcast(["a"])
    expect(gate.settle()).toEqual(["a"])
    expect(gate.isPending()).toBe(false)
  })

  it("keeps the newest broadcast when several arrive while waiting", () => {
    const gate = createPinSyncGate()
    gate.start()
    gate.broadcast(["a"])
    gate.broadcast(["a", "b"])
    gate.broadcast(["a", "b", "c"])
    expect(gate.settle()).toEqual(["a", "b", "c"])
  })

  it("waits for every request in flight before releasing", () => {
    const gate = createPinSyncGate()
    gate.start()
    gate.start()
    gate.broadcast(["a"])
    expect(gate.settle()).toBeNull()
    expect(gate.isPending()).toBe(true)
    expect(gate.settle()).toEqual(["a"])
  })

  it("does not release the same broadcast twice", () => {
    const gate = createPinSyncGate()
    gate.start()
    gate.broadcast(["a"])
    expect(gate.settle()).toEqual(["a"])
    expect(gate.settle()).toBeNull()
  })

  it("goes back to applying broadcasts directly after the traffic calms down", () => {
    const gate = createPinSyncGate()
    gate.start()
    gate.broadcast(["a"])
    gate.settle()
    expect(gate.broadcast(["b"])).toEqual(["b"])
  })

  it("never counts below zero when a request settles twice", () => {
    const gate = createPinSyncGate()
    gate.start()
    expect(gate.settle()).toBeNull()
    expect(gate.settle()).toBeNull()
    expect(gate.isPending()).toBe(false)
    expect(gate.broadcast(["a"])).toEqual(["a"])
  })
})
