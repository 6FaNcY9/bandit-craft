# Ollama, loopback only, GPU via CDI. The Andy-4.2 import was removed with mcagents (2026-11-11);
# models are pulled by hand.
#
# The official image, not nixpkgs' ollama-cuda: that one is not in
# cache.nixos.org (unfree CUDA) and compiled for ~50 min on the laptop - in CI
# (120-minute Cachix job) and on the lab at every nixpkgs bump. Before the first
# activation stop the old user unit on the same port:
# `systemctl --user disable --now mcagents-ollama`.
{...}: {
  hardware.nvidia-container-toolkit.enable = true; # writes the CDI spec for nvidia.com/gpu

  virtualisation.oci-containers.containers.ollama = {
    image = "ollama/ollama@sha256:da6e0dc5651df159e45686fd663c4dbe1624a52c44d7280eeac1551d8f865532"; # 0.34.2
    ports = ["127.0.0.1:11434:11434"];
    # The import staging directory is the host's and read-only here: the root
    # import unit below must never follow links the container could plant.
    volumes = ["/srv/ollama:/root/.ollama" "/var/lib/ollama-import:/import:ro"];
    environment = {
      OLLAMA_NUM_PARALLEL = "4";
      OLLAMA_KEEP_ALIVE = "30m";
    };
    extraOptions = ["--device=nvidia.com/gpu=all" "--security-opt=no-new-privileges"];
  };

  systemd = {
    tmpfiles.rules = [
      "d /srv/ollama 0700 root root -"
      "d /var/lib/ollama-import 0700 root root -"
    ];

    services.docker-ollama = {
      after = ["nvidia-container-toolkit-cdi-generator.service"];
      wants = ["nvidia-container-toolkit-cdi-generator.service"];
    };
  };
}
