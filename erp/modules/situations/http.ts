// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"

import {
  ApiErrors,
  BaseApiErrorPolicy,
  BearerAuth,
  CurrentPrincipal,
  TenantHeaders,
  Uuid,
  apiErrorMapping,
  moduleApi,
} from "../../../framework/modules/http/mod.ts"
import { Follow, InboxItem, Situation, SituationsService, SituationType } from "./mod.ts"

const limit = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
)

export const SituationsHttpGroup = HttpApiGroup.make("Situations")
  .add(
    HttpApiEndpoint.get("listSituations", "/situations", {
      headers: TenantHeaders,
      query: {
        legalEntityId: Schema.optionalKey(Uuid),
        type: Schema.optionalKey(SituationType),
        ownerId: Schema.optionalKey(Schema.String),
        status: Schema.optionalKey(Schema.Literals(["open", "resolved"])),
        limit: Schema.optionalKey(limit),
      },
      success: Schema.Array(Situation),
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.post("assignSituations", "/situations/assign", {
      headers: TenantHeaders,
      payload: Schema.Struct({
        situationIds: Schema.Array(Uuid).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
        ownerId: Schema.String.check(Schema.isPattern(/\S/)),
      }),
      success: Schema.Array(Situation),
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.post("followSituations", "/situations/follows", {
      headers: TenantHeaders,
      payload: Schema.Struct({
        flowType: Schema.optionalKey(SituationType),
        subjectType: Schema.optionalKey(Schema.String),
        subjectId: Schema.optionalKey(Uuid),
      }),
      success: Follow,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.get("listSituationFollows", "/situations/follows", {
      headers: TenantHeaders,
      success: Schema.Array(Follow),
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.delete("unfollowSituations", "/situations/follows/:id", {
      params: { id: Uuid },
      headers: TenantHeaders,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.get("listSituationInbox", "/situations/inbox", {
      headers: TenantHeaders,
      query: { unreadOnly: Schema.optionalKey(Schema.Literals(["true", "false"])) },
      success: Schema.Array(InboxItem),
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.post("markSituationInboxRead", "/situations/inbox/read", {
      headers: TenantHeaders,
      payload: Schema.Struct({
        itemIds: Schema.Array(Uuid).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
      }),
      success: Schema.Struct({ marked: Schema.Int }),
      error: ApiErrors,
    }).middleware(BearerAuth),
  )

const SituationsHttpApi = moduleApi(SituationsHttpGroup)

export const SituationsHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  CalendarInvalid: "conflict",
  FollowNotAllowed: "forbidden",
  FollowNotFound: "not_found",
  OwnerNotEligible: "conflict",
  SituationNotFound: "not_found",
})

export const SituationsHttpHandlers = HttpApiBuilder.group(
  SituationsHttpApi,
  "Situations",
  (handlers) =>
    Effect.gen(function* () {
      const situations = yield* SituationsService

      return handlers
        .handle(
          "listSituations",
          Effect.fn("Http.Situations.list")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* SituationsHttpErrors.apiEffect(
              situations.list({ principal, tenantId: headers["x-tenant-id"], ...query }),
            )
          }),
        )
        .handle(
          "assignSituations",
          Effect.fn("Http.Situations.assign")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* SituationsHttpErrors.apiEffect(
              situations.assign({ principal, tenantId: headers["x-tenant-id"], ...payload }),
            )
          }),
        )
        .handle(
          "followSituations",
          Effect.fn("Http.Situations.follow")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* SituationsHttpErrors.apiEffect(
              situations.follow({ principal, tenantId: headers["x-tenant-id"], ...payload }),
            )
          }),
        )
        .handle(
          "listSituationFollows",
          Effect.fn("Http.Situations.listFollows")(function* ({ headers }) {
            const principal = yield* CurrentPrincipal

            return yield* SituationsHttpErrors.apiEffect(
              situations.listFollows({ principal, tenantId: headers["x-tenant-id"] }),
            )
          }),
        )
        .handle(
          "unfollowSituations",
          Effect.fn("Http.Situations.unfollow")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal

            return yield* SituationsHttpErrors.apiEffect(
              situations.unfollow({
                principal,
                tenantId: headers["x-tenant-id"],
                followId: params.id,
              }),
            )
          }),
        )
        .handle(
          "listSituationInbox",
          Effect.fn("Http.Situations.inbox")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* SituationsHttpErrors.apiEffect(
              situations.listInbox({
                principal,
                tenantId: headers["x-tenant-id"],
                unreadOnly: query.unreadOnly === "true",
              }),
            )
          }),
        )
        .handle(
          "markSituationInboxRead",
          Effect.fn("Http.Situations.markRead")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* SituationsHttpErrors.apiEffect(
              situations
                .markRead({ principal, tenantId: headers["x-tenant-id"], ...payload })
                .pipe(Effect.map((marked) => ({ marked }))),
            )
          }),
        )
    }),
)
