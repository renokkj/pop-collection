package com.popcollection.api.me;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.popcollection.api.auth.UsuarioLogado;
import com.popcollection.api.profile.ProfileRepository;

@Service
public class MeService {

    private final ProfileRepository profiles;

    public MeService(ProfileRepository profiles) {
        this.profiles = profiles;
    }

    @Transactional(readOnly = true)
    public MeResponse buscar(UsuarioLogado usuario) {
        MeResponse.Perfil perfil = profiles.findById(usuario.id())
                .map(p -> new MeResponse.Perfil(p.getUsername(), p.getDisplayName(), p.getAvatarPath()))
                .orElse(null);
        return new MeResponse(usuario.id(), usuario.email(), perfil);
    }
}
