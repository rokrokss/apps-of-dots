import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, Routes } from "discord.js";
import { discord } from "../src/client.js";
import { parsePermissionNames } from "../src/client.js";
import messages from "../src/tools/messages.js";
import scheduledEvents from "../src/tools/scheduledEvents.js";

const CHANNEL = "111111111111111111";
const MESSAGE = "222222222222222222";

afterEach(() => mock.restoreAll());

test("crosspost rejects non-announcement channels with an actionable error", async () => {
  mock.method(
    discord.channels,
    "fetch",
    async () => ({ type: ChannelType.GuildText, guildId: CHANNEL }) as never,
  );
  await assert.rejects(
    () =>
      messages.handlers.get("discord_crosspost_message")!({
        channel_id: CHANNEL,
        message_id: MESSAGE,
      }),
    /announcement channel/,
  );
});

test("delete_message sends the audit-log reason through the raw REST route", async () => {
  const fakeChannel = {
    id: CHANNEL,
    isDMBased: () => false,
    isTextBased: () => true,
    messages: { fetch: async () => ({}) },
  };
  mock.method(discord.channels, "fetch", async () => fakeChannel as never);
  const restCalls: unknown[][] = [];
  mock.method(discord.rest, "delete", (async (...args: unknown[]) => {
    restCalls.push(args);
    return {};
  }) as never);
  await messages.handlers.get("discord_delete_message")!({
    channel_id: CHANNEL,
    message_id: MESSAGE,
    reason: "spam cleanup",
  });
  assert.equal(restCalls.length, 1);
  assert.equal(restCalls[0][0], Routes.channelMessage(CHANNEL, MESSAGE));
  assert.deepEqual(restCalls[0][1], { reason: "spam cleanup" });
});

test("scheduled events reject non-ISO datetimes before any API call", async () => {
  await assert.rejects(
    () =>
      scheduledEvents.handlers.get("discord_create_scheduled_event")!({
        guild_id: CHANNEL,
        name: "x",
        entity_type: "EXTERNAL",
        location: "here",
        scheduled_start_time: "tomorrow",
        scheduled_end_time: "2030-01-01T10:00:00Z",
      }),
    /scheduled_start_time/,
  );
});

test("parsePermissionNames validates shape and flag names with the culprit named", () => {
  assert.deepEqual(parsePermissionNames(["SendMessages"]), ["SendMessages"]);
  assert.deepEqual(parsePermissionNames('["SendMessages","ViewChannel"]'), [
    "SendMessages",
    "ViewChannel",
  ]);
  assert.deepEqual(parsePermissionNames(undefined), []);
  assert.throws(() => parsePermissionNames("SendMessages"), /not a JSON array/);
  assert.throws(() => parsePermissionNames('"SendMessages"'), /array of permission flag names/);
  assert.throws(() => parsePermissionNames(["NotARealFlag"]), /NotARealFlag/);
});
