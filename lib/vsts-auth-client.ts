
import { decode } from "jsonwebtoken";
import { Config } from "./config";
import fetch from "node-fetch";
import * as querystring from 'querystring';
import { run } from '../index';

const k_REFRESH_TOKEN = "refresh_token";

const ONE_SECOND_IN_MS = 1000;

export class AuthorizationError extends Error {
  constructor(...a: Array<any>) {
    super(...a);
  }
}

interface IDecodedToken {
  [key: string]: string | number;
}

export function getVstsLabOauthToken(): string {
  return process.env["SYSTEM_ACCESSTOKEN"];
}

export function isVstsFeedUrl(url: string): boolean {
  if (!(url.indexOf("/_packaging/") > -1)) {
    return false;
  }

  let isLegacyUri = url.indexOf("pkgs.visualstudio.com/") > -1;
  if (isLegacyUri) {
    return true;
  } else {
    let isAdoUri = url.indexOf("pkgs.dev.azure.com/") > -1;
    return isAdoUri;
  }
}

export function setRefreshToken(token: string) {
  Config.set(k_REFRESH_TOKEN, token);
}

export async function getUserAuthToken(): Promise<string> {
  let configObj = Config.get();
  // validate config
  if (!configObj || !configObj.tokenEndpoint) {
    return Promise.reject(new Error("invalid config, missing tokenEndpoint"));
  } else if (!configObj[k_REFRESH_TOKEN]) {
    return Promise.reject(new AuthorizationError("missing " + k_REFRESH_TOKEN));
  }

  const response = await fetch(`${configObj.tokenEndpoint}?${querystring.stringify({ code: configObj[k_REFRESH_TOKEN] })}`, {
    method: 'POST'
  });

  const body = await response.json();

  if (body && body.expires_in) {
    const expiresIn = Number(body.expires_in);
    // TODO: log below after expiring
    console.log(`Re-Authenticate after ${expiresIn}`);
    setTimeout(() => {
      console.log('Re-Authenticating npmrc...');
      run();
    }, expiresIn * 1000);
  }

  if (!body || !body[k_REFRESH_TOKEN] || !body.access_token) {
    throw "malformed response body:\n" + body;
  }

  // stash the refresh_token
  Config.set(k_REFRESH_TOKEN, body[k_REFRESH_TOKEN]);
  const accessToken = body.access_token;

  // VSTS auth service doesn't accomodate clock skew well
  // in these "JIT" scenarios. Check if the token nbf is
  // after our time, and wait for the difference if it is.
  let newTokenDecoded = decode(accessToken) as IDecodedToken;
  console.log(
    "\nnew token received:",
    "\n\tnbf:",
    newTokenDecoded && newTokenDecoded.nbf,
    "\n\texp:",
    newTokenDecoded && newTokenDecoded.exp,
    "\n\tscope:",
    newTokenDecoded && newTokenDecoded.scp
  );

  // print out information about the token's time window for which it's valid
  const now = Date.now();
  const NOW_IN_EPOCH = Math.floor(now / ONE_SECOND_IN_MS);
  if (newTokenDecoded.nbf > NOW_IN_EPOCH) {
    const timeToWaitInMs =
      Math.floor((newTokenDecoded.nbf as number) - NOW_IN_EPOCH) *
      ONE_SECOND_IN_MS;
    console.log("waiting out clock skew of", timeToWaitInMs, "milliseconds.");
    await new Promise(r => setTimeout(r, timeToWaitInMs));
  }

  return accessToken;
}
