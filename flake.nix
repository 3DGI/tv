{
  description = "Cesium 3D Tiles Viewer dev environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
      src = builtins.path {
        path = ./.;
        name = "3dtiles-tester-src";
      };
    in {
      packages = forAllSystems (pkgs: {
        default = pkgs.writeShellApplication {
          name = "3dtiles-tester";
          runtimeInputs = [ pkgs.bun ];
          text = ''
            exec bun ${src}/cli.ts "$@"
          '';
        };
      });

      apps = forAllSystems (pkgs: {
        default = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.default}/bin/3dtiles-tester";
        };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.bun ];
          shellHook = ''
            echo "3dtiles-tester dev shell — bun $(bun --version)"
          '';
        };
      });
    };
}
