export function validate(schema) {
  return (req, res, next) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params
      });
      req.validated = parsed;
      next();
    } catch (err) {
      if (err.errors) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Input validation failed',
            details: err.errors.map(e => ({
              path: e.path.join('.'),
              message: e.message
            }))
          }
        });
      }
      next(err);
    }
  };
}
