import { expect } from "chai";
import fs from "fs";
import path from "path";
import os from "os";
import {
  writeDefaultConfig,
  loadConfig,
  updateConfigMint,
} from "../src/config";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sss-cli-test-"));
}

describe("Config – writeDefaultConfig", function () {
  it("writes a valid SSS-1 config", function () {
    const dir = tmpDir();
    const outPath = path.join(dir, "sss1.toml");
    const result = writeDefaultConfig("sss-1", outPath);

    expect(result).to.equal(outPath);
    expect(fs.existsSync(outPath)).to.be.true;

    const content = fs.readFileSync(outPath, "utf8");
    expect(content).to.include('standard = "sss-1"');
    expect(content).to.include('cluster = "devnet"');
    expect(content).to.include("[stablecoin]");
    expect(content).to.include("[authorities]");
    expect(content).to.include("[extensions.metadata]");
    expect(content).to.include("enabled = true");
    expect(content).to.include("[extensions.transferHook]");
    expect(content).to.include("enabled = false");
  });

  it("writes a valid SSS-2 config with transfer hook enabled", function () {
    const dir = tmpDir();
    const outPath = path.join(dir, "sss2.toml");
    writeDefaultConfig("sss-2", outPath);

    const content = fs.readFileSync(outPath, "utf8");
    expect(content).to.include('standard = "sss-2"');
    expect(content).to.include("[extensions.transferHook]");
    expect(content).to.include("enabled = true");
    expect(content).to.include("blacklist");
  });

  it("SSS-2 config includes blacklist authority", function () {
    const dir = tmpDir();
    const outPath = path.join(dir, "sss2.toml");
    writeDefaultConfig("sss-2", outPath);

    const content = fs.readFileSync(outPath, "utf8");
    expect(content).to.match(/blacklist\s*=\s*"/);
  });
});

describe("Config – loadConfig", function () {
  it("loads and parses a valid SSS-1 config", function () {
    const dir = tmpDir();
    const outPath = path.join(dir, "test.toml");
    writeDefaultConfig("sss-1", outPath);

    const cfg = loadConfig(outPath);

    expect(cfg.standard).to.equal("sss-1");
    expect(cfg.cluster).to.equal("devnet");
    expect(cfg.stablecoin.name).to.equal("My Stablecoin");
    expect(cfg.stablecoin.symbol).to.equal("MUSD");
    expect(cfg.stablecoin.decimals).to.equal(6);
    expect(cfg.stablecoin.tokenProgram).to.equal("spl-token-2022");
    expect(cfg.stablecoin.mint).to.equal("");
    expect(cfg.authorities.mint).to.be.a("string");
    expect(cfg.authorities.freeze).to.be.a("string");
    expect(cfg.authorities.metadata).to.be.a("string");
  });

  it("loads and parses a valid SSS-2 config", function () {
    const dir = tmpDir();
    const outPath = path.join(dir, "test2.toml");
    writeDefaultConfig("sss-2", outPath);

    const cfg = loadConfig(outPath);

    expect(cfg.standard).to.equal("sss-2");
    expect(cfg.extensions?.transferHook?.enabled).to.be.true;
    expect(cfg.authorities.blacklist).to.be.a("string");
  });

  it("throws for non-existent file", function () {
    expect(() => loadConfig("/tmp/does_not_exist_12345.toml")).to.throw(
      "Config file not found",
    );
  });

  it("throws for invalid standard", function () {
    const dir = tmpDir();
    const outPath = path.join(dir, "bad.toml");
    fs.writeFileSync(
      outPath,
      `
standard = "sss-99"
cluster = "devnet"

[stablecoin]
name = "Bad"
symbol = "BAD"
decimals = 6
tokenProgram = "spl-token-2022"
mint = ""

[authorities]
mint = "test.json"
freeze = "test.json"
metadata = "test.json"
`,
    );

    expect(() => loadConfig(outPath)).to.throw("Unsupported standard");
  });

  it("throws when stablecoin name is missing", function () {
    const dir = tmpDir();
    const outPath = path.join(dir, "noname.toml");
    fs.writeFileSync(
      outPath,
      `
standard = "sss-1"
cluster = "devnet"

[stablecoin]
symbol = "BAD"
decimals = 6
tokenProgram = "spl-token-2022"
mint = ""

[authorities]
mint = "test.json"
freeze = "test.json"
metadata = "test.json"
`,
    );

    expect(() => loadConfig(outPath)).to.throw("name and symbol");
  });

  it("throws when authorities are missing", function () {
    const dir = tmpDir();
    const outPath = path.join(dir, "noauth.toml");
    fs.writeFileSync(
      outPath,
      `
standard = "sss-1"
cluster = "devnet"

[stablecoin]
name = "Test"
symbol = "TST"
decimals = 6
tokenProgram = "spl-token-2022"
mint = ""
`,
    );

    expect(() => loadConfig(outPath)).to.throw("authorities");
  });
});

describe("Config – updateConfigMint", function () {
  it("updates the mint address in a config file", function () {
    const dir = tmpDir();
    const outPath = path.join(dir, "update.toml");
    writeDefaultConfig("sss-1", outPath);

    const mintAddr = "7NDkaMubatXw8fHQ2zNU4eid8Nkh5vG9SxQMSzUyE9SM";
    updateConfigMint(outPath, mintAddr);

    const content = fs.readFileSync(outPath, "utf8");
    expect(content).to.include(`mint = "${mintAddr}"`);

    const cfg = loadConfig(outPath);
    expect(cfg.stablecoin.mint).to.equal(mintAddr);
  });

  it("throws for non-existent file", function () {
    expect(() =>
      updateConfigMint("/tmp/does_not_exist_12345.toml", "abc"),
    ).to.throw("Config file not found");
  });
});
