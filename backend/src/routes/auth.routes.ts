import { Router } from 'express';
import { body } from 'express-validator';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

// ==========================================
// REGISTRO
// ==========================================
router.post('/register',
  [
    body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
    body('password').isLength({ min: 8 }).withMessage('Contraseña mínimo 8 caracteres'),
    body('firstName').notEmpty().trim().withMessage('Nombre requerido'),
    body('lastName').notEmpty().trim().withMessage('Apellido requerido'),
    body('businessName').notEmpty().trim().withMessage('Nombre del negocio requerido'),
    body('industry').notEmpty().withMessage('Industria requerida'),
    body('plan').optional().isIn(['STARTER', 'PRO', 'BUSINESS', 'AGENCY']),
    body('planType').optional().isIn(['MONTHLY', 'LIFETIME']),
  ],
  validate,
  authController.register
);

// ==========================================
// LOGIN
// ==========================================
router.post('/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
    body('password').notEmpty().withMessage('Contraseña requerida'),
  ],
  validate,
  authController.login
);

// ==========================================
// OBTENER USUARIO ACTUAL
// ==========================================
router.get('/me', authenticate, authController.getCurrentUser);

// ==========================================
// ACTUALIZAR PERFIL
// ==========================================
router.put('/profile',
  authenticate,
  [
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
    body('phone').optional().trim(),
  ],
  validate,
  authController.updateProfile
);

// ==========================================
// CAMBIAR CONTRASEÑA
// ==========================================
router.post('/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Contraseña actual requerida'),
    body('newPassword').isLength({ min: 8 }).withMessage('Nueva contraseña mínimo 8 caracteres'),
  ],
  validate,
  authController.changePassword
);

// ==========================================
// CONECTAR API KEY DE OPENAI
// ==========================================
router.post('/connect-api-key',
  authenticate,
  [
    body('apiKey').notEmpty().withMessage('API Key requerida'),
  ],
  validate,
  authController.connectApiKey
);

// ==========================================
// DESCONECTAR API KEY
// ==========================================
router.delete('/disconnect-api-key', authenticate, authController.disconnectApiKey);

// ==========================================
// VERIFICAR CRÉDITOS DE OPENAI
// ==========================================
router.get('/check-credits', authenticate, authController.checkOpenAICredits);

export default router;
