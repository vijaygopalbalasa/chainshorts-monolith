import "react-native-get-random-values";
import "react-native-url-polyfill/auto";
import { Buffer } from "@craftzdog/react-native-buffer";
import { encode as btoa, decode as atob } from "base-64";

const globalObject = globalThis;

if (!globalObject.Buffer) {
  globalObject.Buffer = Buffer;
}

if (!globalObject.btoa) {
  globalObject.btoa = btoa;
}

if (!globalObject.atob) {
  globalObject.atob = atob;
}

if (!globalObject.window) {
  globalObject.window = globalObject;
}

if (!globalObject.window.btoa) {
  globalObject.window.btoa = globalObject.btoa;
}

if (!globalObject.window.atob) {
  globalObject.window.atob = globalObject.atob;
}
