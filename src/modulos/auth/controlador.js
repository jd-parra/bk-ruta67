import { serializarUsuario } from '../usuarios/serializadores.js';
import * as servicio from './servicio.js';

export async function registrar(req, res) {
  const { token, usuario } = await servicio.registrar(req.body);
  res.status(201).json({ token, usuario: serializarUsuario(usuario) });
}

export async function iniciarSesion(req, res) {
  const { token, usuario } = await servicio.iniciarSesion(req.body);
  res.json({ token, usuario: serializarUsuario(usuario) });
}

export function yo(req, res) {
  res.json(serializarUsuario(req.usuario));
}
