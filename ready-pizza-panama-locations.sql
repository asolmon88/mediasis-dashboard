begin;

insert into mediasis.business_location (
  business_location_id,
  business_uid,
  short_name,
  phone_number,
  lat,
  lng,
  text_address
)
values
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - CALIDONIA', '+50660511727', 8.96750617427721, -79.53973120910572, 'XF86+X3X, Panama City, Panamá Province, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - CHANIS', '+50660511727', 9.022583660298096, -79.47840098431135, '2GCC+XHM, Panama City, Panamá Province, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'HERRERA - CHITRÉ', '+50660511727', 7.963831089040935, -80.42782026038059, 'XH7C+GVG, Chitre, Herrera Province, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ OESTE - CHORRERA', '+50660511727', 8.875407207902365, -79.78767165417959, 'V6G6+4WQ, Libertador 191-20, La Chorrera, Provincia de Panamá Oeste, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - CINCO DE MAYO', '+50660511727', 8.960732588067039, -79.5395758338143, 'XF65+FX8, Viad. 3 de Noviembre, Panamá, Provincia de Panamá, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - CITY PLAZA CRISOL', '+50660511727', 9.04342369891601, -79.47154464117764, 'Metro El Crisol-R, Panamá, Provincia de Panamá, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ OESTE - COSTA VERDE', '+50660511727', 8.89364114336704, -79.75119310897364, 'V6VX+GG5, La Chorrera, Panamá Oeste Province, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - EL CANGREJO', '+50660511727', 8.98421666458655, -79.53020144983148, 'Inca, Av. Manuel Espinosa Batista, Panamá, Provincia de Panamá, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - HIPER REY LOS PUEBLOS', '+50660511727', 9.049861302551415, -79.44710540123047, '2HX3+W5F Viva Plaza Los Pueblos, Vía Tocumen, Panamá, Provincia de Panamá, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - LA DOÑA', '+50660511727', 9.103923190310827, -79.37203379942068, '4J3H+H59, La Doña, Panamá, Provincia de Panamá, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - LA SIESTA', '+50660511727', 9.077903421991923, -79.36680984441746, 'Manzana 080819 247-90, Panamá, Provincia de Panamá, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - MILLA 8', '+50660511727', 9.069142712358525, -79.5185606656821, '3F9J+JJR, San Miguelito, Panamá Province, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - PLAZA CAROLINA', '+50660511727', 9.028581654593163, -79.47887802973786, '2GHC+CC2, Panama City, Panamá Province, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - PLAZA CÓRBODA', '+50660511727', 9.001547464266837, -79.5198154674751, 'Vía Fernández de Córdoba 6, Panamá, Provincia de Panamá, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - PLAZA JUAN DÍAZ', '+50660511727', 9.039850367765098, -79.46220111723277, '31358-02, Av. José Agustín Arango 31358-02, Panamá, Provincia de Panamá, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - PLAZA LOS ÁNGELES', '+50660511727', 8.998568923195485, -79.53310004740439, 'XFX8+9QW, Panama City, Panamá Province, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - LAS MAÑANITAS', '+50660511727', 9.079909453970243, -79.40616201329338, 'Manzana 080820 155339-2, Panamá, Provincia de Panamá, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'COLÓN - SABANITAS', '+50660511727', 9.347933949955221, -79.80647240981517, '85XV+5C8, Carr Transístmica, Sabanitas, Provincia de Colón, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - POLIPLAZA SAN MIGUELITO', '+50660511727', 9.025315063474531, -79.50471060411182, '2FGW+44V, Panama City, Panamá Province, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'VERAGUAS - SANTIAGO', '+50660511727', 8.097754388697437, -80.97555363379139, 'Central 147-10, Santiago, Provincia de Veraguas, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - VERSALLES', '+50660511727', 9.043213059377004, -79.41603853378332, 'Calle 61501 61501-03, Panamá, Provincia de Panamá, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ - VÍA ESPAÑA', '+50660511727', 8.989973586497205, -79.52173761548629, 'XFQH+X8M, Vía España, Panamá, Provincia de Panamá, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ OESTE - VISTA ALEGRE', '+50660511727', 8.925011174491791, -79.71128372152062, 'W7FQ+XFW, Vista Alegre, Panamá Oeste Province, Panama'),
  (gen_random_uuid(), '8b160a88-8afc-4cfe-86ea-6ecb647ae520'::uuid, 'PANAMÁ OESTE - WEST TEXACO', '+50660511727', 8.916838084525335, -79.71281076144952, 'Manzana 130102 307-191, Nuevo Arraiján, Provincia de Panamá Oeste, Panama');

commit;
