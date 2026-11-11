import { describe, expect, it } from "vitest";
import { PANEL_ID, activate, deactivate } from "../src/index";
import { STAGE_ID, qualified } from "../src/params";
import { fakeApi } from "./support/fake-api";

describe("activate", () => {
  it("registers the stage and a panel that also edits masks", () => {
    const rig = fakeApi();
    activate(rig.api);
    expect(rig.stages.map((s) => s.id)).toEqual([STAGE_ID]);
    expect(rig.panels.map((p) => p.id)).toEqual([PANEL_ID]);
    expect(rig.panels[0].mask?.owns).toEqual([qualified("passes"), qualified("amount"), qualified("luminanceOnly"), qualified("draws")]);
    deactivate();
  });

  it("resets the edit in one undo step", () => {
    const rig = fakeApi({ [qualified("amount")]: 40, [qualified("draws")]: 2 });
    activate(rig.api);
    rig.panels[0].onReset?.();
    expect(rig.params()[qualified("amount")]).toBe(0);
    expect(rig.params()[qualified("draws")]).toBe(0);
    expect(rig.commits).toEqual(["Sharpen Edges reset"]);
    deactivate();
  });

  it("re-derives the draw count of a pasted edit", () => {
    const rig = fakeApi();
    activate(rig.api);
    rig.replace({ [qualified("amount")]: 50, [qualified("passes")]: 3 });
    expect(rig.params()[qualified("draws")]).toBe(3);
    deactivate();
  });

  it("re-derives a mask's", () => {
    const rig = fakeApi();
    activate(rig.api);
    rig.setMasks([{ id: "m1", bag: { [qualified("amount")]: 50 } }]);
    expect(rig.maskBag("m1")?.[qualified("draws")]).toBe(2);
    deactivate();
  });

  it("stops re-deriving once deactivated", () => {
    const rig = fakeApi();
    activate(rig.api);
    deactivate();
    rig.replace({ [qualified("amount")]: 50 });
    expect(rig.params()[qualified("draws")]).toBeUndefined();
  });
});
