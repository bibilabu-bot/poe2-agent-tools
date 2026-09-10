(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.plannerJewelCatalog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  // Reviewed local governance data. IDs are never generated from display names.
  const definitions = Object.freeze([
    ["poe2-jewel:unique-voices", "Voices", "active", "unsupported", "grant_sinister_sockets"],
    ["poe2-jewel:unique-from-nothing", "From Nothing", "active", "unsupported", "disconnected_allocation"],
    ["poe2-jewel:unique-controlled-metamorphosis", "Controlled Metamorphosis", "active", "unverified", "ring_disconnected_allocation"],
    ["poe2-jewel:unique-the-adorned", "The Adorned", "active", "unsupported", "jewel_effect_multiplier"],
    ["poe2-jewel:unique-flesh-crucible", "Flesh Crucible", "active", "unsupported", "random_keystone"],
    ["poe2-jewel:unique-against-the-darkness", "Against the Darkness", "active", "unverified", "time_lost_radius"],
  ].map(([definitionId, displayName, status, radiusStatus, ruleFamily]) => Object.freeze({
    definitionId, displayName, status, radius: Object.freeze({ status: radiusStatus }), ruleFamily,
  })));
  const sockets = Object.freeze([
    ["2491", "jewel_slot1974"], ["7960", "jewel_slot1969"], ["21984", "jewel_slot1979"],
    ["26196", "jewel_slot1977"], ["26725", "jewel_slot1956"], ["32763", "jewel_slot1976"],
    ["46882", "jewel_slot1970"], ["54127", "jewel_slot1975"], ["55190", "jewel_slot1971"],
    ["60735", "jewel_slot1960"], ["61419", "jewel_slot1972"], ["61834", "jewel_slot1961"],
  ].map(([nodeId, officialRawId]) => Object.freeze({ nodeId, officialRawId, category: "ordinary" })));
  return Object.freeze({ definitions, sockets });
});
