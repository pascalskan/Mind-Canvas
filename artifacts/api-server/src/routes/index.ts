import { Router, type IRouter } from "express";
import healthRouter from "./health";
import mapRouter from "./map";

const router: IRouter = Router();

router.use(healthRouter);
router.use(mapRouter);

export default router;
