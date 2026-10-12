# The gaming PCs the laptop administers (pc-admin.nix) and the lab tunnels to for Andy
# (hosts/bandit-lab/services/llamacpp/slayer-tunnel.nix): tailnet address, Windows account, SSH host
# key. albert joins when it gets the PC manager (bandit-nix still sets its tunnel).
{
  slayer = {
    address = "100.76.40.98";
    user = "yassi";
    hostKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIQqLzKYo4S6Ldqfyt9kWOUPNg82r8/QsJTKOPsqN1G9";
  };
}
