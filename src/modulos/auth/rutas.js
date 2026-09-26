import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { limitarLogin, limitarRegistro } from '../../middlewares/limitar.js';
import { validar } from '../../middlewares/validar.js';
import * as controlador from './controlador.js';
import { esquemaLogin, esquemaRegistro } from './esquemas.js';

export const rutasAuth = Router();

rutasAuth.post('/auth/registro', limitarRegistro, validar(esquemaRegistro), controlador.registrar);
rutasAuth.post('/auth/login', limitarLogin, validar(esquemaLogin), controlador.iniciarSesion);
// Un usuario bloqueado igual puede ver su perfil (ahí ve que está bloqueado).
rutasAuth.get('/me', autenticar({ permitirBloqueado: true }), controlador.yo);
