import { Executor } from "../index";
import * as fs from "fs";
import * as path from "path";
import * as mime from "mime";

export default class ResourceService extends Executor {
  _resolved: string;

  normalizeParams() {
    this._params.url = this._params.url || "resources";
    if (!this._params.url.startsWith("/")) {
      this._params.url = "/" + this._params.url;
    }
    if (!this._params.url.endsWith("/")) {
      this._params.url += "/";
    }

    this._params.folder = this._params.folder || "." + this._params.url;
    if (!this._params.folder.endsWith("/")) {
      this._params.folder += "/";
    }
    this._resolved = path.resolve(this._params.folder) + "/";
  }

  initRoutes() {
    this._addRoute(this._params.url, ["GET"], this._serve, {
      get: {
        description: "Get resources",
        summary: "Get file",
        operationId: "getResource",
        responses: {
          "200": "",
          "401": "Illegal resource",
          "404": "File not found"
        }
      }
    });
    this._addRoute(
      this._params.url + "{resource}",
      ["GET"],
      this._serve,
      {
        get: {
          description: "Get resources",
          summary: "Get file",
          operationId: "getResources",
          responses: {
            "200": "",
            "401": "Illegal resource",
            "404": "File not found"
          }
        }
      },
      true
    );
  }

  _serve(ctx) {
    let resource = ctx.parameter("resource") || "index.html";
    let file = this._params.folder + resource;
    if (!path.resolve(file).startsWith(this._resolved)) {
      throw 401;
    }
    if (!fs.existsSync(file)) {
      throw 404;
    }
    ctx.writeHead(200, {
      "Content-Type": mime.getType(file) || "application/octet-stream"
    });
    ctx.write(fs.readFileSync(file));
    ctx.end();
  }
}

export { ResourceService };
