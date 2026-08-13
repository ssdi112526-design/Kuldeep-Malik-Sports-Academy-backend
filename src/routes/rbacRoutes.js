import { Router } from 'express';
import { protect, requirePermission, requireAdminAccess } from '../middleware/auth.js';
import { uploadProfileImage, withMediaBlobBackup } from '../middleware/upload.js';

const runProfileUpload = withMediaBlobBackup(uploadProfileImage);
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  setUserStatus,
  resetUserPassword,
  generatePassword,
} from '../controllers/userController.js';
import {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  cloneRole,
  listPermissionsCatalog,
} from '../controllers/roleController.js';

const router = Router();

const usersView = [protect, requireAdminAccess, requirePermission('users.view')];
const usersCreate = [protect, requireAdminAccess, requirePermission('users.create')];
const usersEdit = [protect, requireAdminAccess, requirePermission('users.edit')];
const usersDelete = [protect, requireAdminAccess, requirePermission('users.delete')];
const rolesView = [protect, requireAdminAccess, requirePermission('roles.view')];
const rolesCreate = [protect, requireAdminAccess, requirePermission('roles.create')];
const rolesEdit = [protect, requireAdminAccess, requirePermission('roles.edit')];
const rolesDelete = [protect, requireAdminAccess, requirePermission('roles.delete')];

router.get('/admin/permissions', ...rolesView, listPermissionsCatalog);

router.get('/admin/roles', ...rolesView, listRoles);
router.get('/admin/roles/:id', ...rolesView, getRole);
router.post('/admin/roles', ...rolesCreate, createRole);
router.put('/admin/roles/:id', ...rolesEdit, updateRole);
router.delete('/admin/roles/:id', ...rolesDelete, deleteRole);
router.post('/admin/roles/:id/clone', ...rolesCreate, cloneRole);

router.get('/admin/users', ...usersView, listUsers);
router.get('/admin/users/generate-password', ...usersCreate, generatePassword);
router.get('/admin/users/:id', ...usersView, getUser);
router.post(
  '/admin/users',
  ...usersCreate,
  runProfileUpload,
  createUser
);
router.put(
  '/admin/users/:id',
  ...usersEdit,
  runProfileUpload,
  updateUser
);
router.delete('/admin/users/:id', ...usersDelete, deleteUser);
router.patch('/admin/users/:id/status', ...usersEdit, setUserStatus);
router.post('/admin/users/:id/reset-password', ...usersEdit, resetUserPassword);

export default router;
