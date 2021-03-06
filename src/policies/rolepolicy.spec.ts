import { suite, test } from "mocha-typescript";
import * as assert from "assert";
import {
  CoreModel,
  User,
  Core,
  SecureCookie,
  RolePolicyMixIn,
  HttpContext
} from "../index";
var config = require("../../test/config.json");
const Utils = require("../../test/utils");

class RolePolicyModel extends RolePolicyMixIn(CoreModel, {
  get: "member",
  update: "member",
  delete: "admin"
}) {}

class RolePolicyModelPermissive extends RolePolicyMixIn(
  CoreModel,
  {
    get: "member",
    create: "member"
  },
  true
) {}

@suite
class RolePolicyTest {
  _ctx;
  nonPermissive: RolePolicyModel;
  permissive: RolePolicyModel;
  _webda: Core;
  _session: SecureCookie;
  _user: User;

  async before() {
    this._webda = new Core(config);
    this._ctx = await this._webda.newContext(
      new HttpContext("test.webda.io", "GET", "/")
    );
    this._session = this._ctx.newSession();
    this._session.login("none", "none");
    this._ctx.getCurrentUser = async () => {
      return this._user;
    };
    this.nonPermissive = new RolePolicyModel();
    this.permissive = new RolePolicyModelPermissive();
    this._user = new User();
    this._user.addRole("member");
  }

  @test async get() {
    assert.equal(
      await this.permissive.canAct(this._ctx, "get"),
      this.permissive
    );
    assert.equal(
      await this.nonPermissive.canAct(this._ctx, "get"),
      this.nonPermissive
    );
  }
  @test async action() {
    assert.equal(
      await this.permissive.canAct(this._ctx, "action"),
      this.permissive
    );
    await Utils.throws(
      this.nonPermissive.canAct.bind(this.nonPermissive, this._ctx, "action")
    );
  }

  @test async delete() {
    assert.equal(
      await this.permissive.canAct(this._ctx, "delete"),
      this.permissive
    );
    await Utils.throws(
      this.nonPermissive.canAct.bind(this.nonPermissive, this._ctx, "delete")
    );
    this._user.addRole("admin");
    this._session.roles = undefined;
    assert.equal(
      await this.nonPermissive.canAct(this._ctx, "delete"),
      this.nonPermissive
    );
  }
}
