class Zenith < Formula
  desc "Model-agnostic terminal AI coding agent with first-class safety and sandboxing"
  homepage "https://github.com/zenith-code/zenith"
  url "https://registry.npmjs.org/@forge/cli/-/cli-0.1.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "Apache-2.0"

  depends_on "node@22"
  depends_on "ripgrep"
  depends_on "git"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    system "#{bin}/zenith", "--version"
    output = shell_output("#{bin}/zenith doctor")
    assert_match "Doctor", output
  end
end
