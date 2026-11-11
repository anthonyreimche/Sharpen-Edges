import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { activate } from "../src/index";
import { SharpenEdgesPanel } from "../src/Panel";
import { qualified } from "../src/params";
import { React } from "../src/rt";
import { fakeApi } from "./support/fake-api";

function setup(params: Record<string, unknown> = {}) {
  const rig = fakeApi(params);
  activate(rig.api);
  const view = render(<SharpenEdgesPanel />);
  const slider = (label: string) => {
    const found = rig.sliders(view.container).find((s) => s.label === label);
    if (!found) throw new Error(`no slider ${label}`);
    return found;
  };
  const toggle = () => view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  return { rig, view, slider, toggle };
}

afterEach(cleanup);

describe("the panel", () => {
  it("has Iterations, Amount and Luminance only, in that order", () => {
    const { rig, view, toggle } = setup();
    expect(rig.sliders(view.container).map((s) => s.label)).toEqual(["Iterations", "Amount"]);
    expect(toggle()?.getAttribute("aria-label")).toBe("Luminance only");
  });

  it("shows the limits and defaults: 1 to 4 iterations, an amount of 0 to 100, off", () => {
    const { slider, toggle } = setup();
    expect(slider("Iterations")).toMatchObject({ value: 2, min: 1, max: 4, step: 1, defaultValue: 2 });
    expect(slider("Amount")).toMatchObject({ value: 0, min: 0, max: 100, step: 1, defaultValue: 0 });
    expect(toggle()?.checked).toBe(false);
  });

  it("writes the value and the draw count as a slider moves, and one undo step on release", () => {
    const { rig, slider } = setup();
    act(() => slider("Amount").onChange(50));
    expect(rig.params()).toEqual({ [qualified("amount")]: 50, [qualified("draws")]: 2 });
    expect(slider("Amount").value).toBe(50);
    act(() => slider("Amount").onCommit?.());
    expect(rig.commits).toEqual(["Sharpen Edges: amount"]);
  });

  it("sizes the draw count by the iterations the edit holds", () => {
    const { rig, slider } = setup({ [qualified("amount")]: 50 });
    act(() => slider("Iterations").onChange(4));
    expect(rig.params()[qualified("draws")]).toBe(4);
    act(() => slider("Iterations").onCommit?.());
    expect(rig.commits).toEqual(["Sharpen Edges: iterations"]);
  });

  it("draws nothing while the amount is 0, whatever the iterations", () => {
    const { rig, slider } = setup();
    act(() => slider("Iterations").onChange(3));
    expect(rig.params()[qualified("draws")]).toBe(0);
  });

  it("switches luminance only on and off in one undo step each", () => {
    const { rig, toggle } = setup({ [qualified("amount")]: 50 });
    act(() => void fireEvent.click(toggle() as HTMLInputElement));
    expect(rig.params()[qualified("luminanceOnly")]).toBe(true);
    expect(rig.params()[qualified("draws")]).toBe(2);
    expect(rig.commits).toEqual(["Sharpen Edges: luminance only"]);
    act(() => void fireEvent.click(toggle() as HTMLInputElement));
    expect(rig.params()[qualified("luminanceOnly")]).toBe(false);
  });
});
